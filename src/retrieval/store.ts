import { Prisma, type PrismaClient } from "@prisma/client";
import type { RetrievedChunk } from "../core/types.js";

/**
 * Vector store over the `chunks` table. Prisma can't express the `<=>` operator,
 * so the ANN query is raw SQL; everything else (writes, deletes) goes through
 * Prisma. `1 - (embedding <=> q)` converts pgvector cosine *distance* to a 0..1
 * *similarity* so the rest of the code deals in one direction.
 */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

/** The retrieval pipeline depends on this, not the concrete class, so evals and
 * tests can supply an in-memory implementation. */
export interface VectorSearch {
  search(queryVector: number[], opts: { topK: number; corpusTag?: string }): Promise<RetrievedChunk[]>;
}

type Row = {
  chunkId: string;
  documentId: string;
  sourceUri: string;
  title: string;
  ordinal: number;
  content: string;
  similarity: number;
};

export class VectorStore implements VectorSearch {
  constructor(private readonly prisma: PrismaClient) {}

  async search(queryVector: number[], opts: { topK: number; corpusTag?: string }): Promise<RetrievedChunk[]> {
    const q = toVectorLiteral(queryVector);
    const corpusFilter = opts.corpusTag ? Prisma.sql`AND d."corpusTag" = ${opts.corpusTag}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT
        c.id                              AS "chunkId",
        c."documentId"                    AS "documentId",
        d."sourceUri"                     AS "sourceUri",
        d.title                           AS "title",
        c.ordinal                         AS "ordinal",
        c.content                         AS "content",
        1 - (c.embedding <=> ${q}::vector) AS "similarity"
      FROM chunks c
      JOIN documents d ON d.id = c."documentId"
      WHERE c.embedding IS NOT NULL
      ${corpusFilter}
      ORDER BY c.embedding <=> ${q}::vector
      LIMIT ${opts.topK}
    `;

    return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
  }

  /** Replace all chunks for a document in one transaction (re-ingest). */
  async replaceChunks(
    documentId: string,
    chunks: Array<{ ordinal: number; content: string; tokenCount: number; embedding: number[] }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.chunk.deleteMany({ where: { documentId } });
      for (const ch of chunks) {
        await tx.chunk.create({
          data: { documentId, ordinal: ch.ordinal, content: ch.content, tokenCount: ch.tokenCount },
        });
        // embedding column is Unsupported() — set it with raw SQL by ordinal
        await tx.$executeRaw`
          UPDATE chunks SET embedding = ${toVectorLiteral(ch.embedding)}::vector
          WHERE "documentId" = ${documentId}::uuid AND ordinal = ${ch.ordinal}
        `;
      }
      await tx.document.update({ where: { id: documentId }, data: { chunkCount: chunks.length } });
    });
  }
}
