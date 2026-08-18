import type { PrismaClient } from "@prisma/client";
import type { Citation } from "../core/types.js";
import { toVectorLiteral } from "../retrieval/store.js";

/**
 * Semantic response cache (ADR-0004). A near-duplicate question — cosine
 * similarity ≥ `minSimilarity` against a stored question embedding — reuses the
 * stored answer without a retrieval or model call.
 *
 * The similarity threshold is deliberately high (default 0.97): a wrong cache
 * hit returns a confidently-worded answer to a different question, which is
 * worse than a cache miss. Entries carry the corpus version and expire by TTL;
 * a re-ingest bumps the version and orphans the old rows.
 */
export type SemanticHit = {
  id: string;
  answer: string;
  citations: Citation[];
  model: string;
  similarity: number;
};

type Row = { id: string; answer: string; citations: unknown; model: string; similarity: number };

export class SemanticCache {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly opts: { minSimilarity: number; ttlSeconds: number; corpusVersion: string },
  ) {}

  async lookup(questionEmbedding: number[]): Promise<SemanticHit | null> {
    const q = toVectorLiteral(questionEmbedding);
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT id, answer, citations, model,
             1 - ("questionEmbedding" <=> ${q}::vector) AS "similarity"
      FROM semantic_cache
      WHERE "corpusVersion" = ${this.opts.corpusVersion}
        AND "expiresAt" > now()
      ORDER BY "questionEmbedding" <=> ${q}::vector
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;
    const similarity = Number(row.similarity);
    if (similarity < this.opts.minSimilarity) return null;

    await this.prisma.semanticCacheEntry.update({ where: { id: row.id }, data: { hits: { increment: 1 } } });
    return { id: row.id, answer: row.answer, citations: row.citations as Citation[], model: row.model, similarity };
  }

  async store(args: {
    question: string;
    questionEmbedding: number[];
    answer: string;
    citations: Citation[];
    model: string;
  }): Promise<void> {
    const expiresAt = new Date(Date.now() + this.opts.ttlSeconds * 1000);
    await this.prisma.$executeRaw`
      INSERT INTO semantic_cache
        (id, question, "questionEmbedding", answer, citations, model, "corpusVersion", "expiresAt")
      VALUES
        (gen_random_uuid(), ${args.question}, ${toVectorLiteral(args.questionEmbedding)}::vector,
         ${args.answer}, ${JSON.stringify(args.citations)}::jsonb, ${args.model},
         ${this.opts.corpusVersion}, ${expiresAt})
    `;
  }

  /** Housekeeping: drop expired rows. Called on a timer by the server. */
  async sweep(): Promise<number> {
    const { count } = await this.prisma.semanticCacheEntry.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    return count;
  }
}
