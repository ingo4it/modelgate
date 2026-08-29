/**
 * Corpus ingest CLI:  pnpm ingest ./corpus [--corpus <tag>]
 *
 * For each *.md / *.txt under the path: hash it, upsert a Document row, and if
 * the content changed, re-chunk, embed (document projection), and replace the
 * chunk set atomically. Idempotent — re-running on an unchanged corpus is a
 * batch of cheap hash comparisons.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve, basename } from "node:path";
import { loadConfig } from "../server/config.js";
import { createLogger } from "../telemetry/logger.js";
import { createPrisma } from "../db/client.js";
import { VoyageEmbedder } from "../retrieval/embeddings.js";
import { VectorStore } from "../retrieval/store.js";
import { chunkDocument } from "../retrieval/chunk.js";

const EMBED_BATCH = 96;

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if ([".md", ".txt"].includes(extname(entry.name))) yield p;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = resolve(args.find((a) => !a.startsWith("--")) ?? "./corpus");
  const corpusTag = valueOf(args, "--corpus") ?? "default";

  const config = loadConfig();
  const logger = createLogger(config);
  const prisma = createPrisma(config.databaseUrl);
  const store = new VectorStore(prisma);
  const embedder = new VoyageEmbedder(config.embedding.apiKey, config.embedding.model, config.embedding.dim);

  if (!(await stat(root)).isDirectory()) throw new Error(`${root} is not a directory`);

  let ingested = 0;
  let skipped = 0;

  for await (const path of walk(root)) {
    const content = await readFile(path, "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const sourceUri = `file://${path}`;
    const title = firstHeading(content) ?? basename(path);

    const existing = await prisma.document.findUnique({ where: { sourceUri } });
    if (existing?.sha256 === sha256) {
      skipped++;
      continue;
    }

    const doc = await prisma.document.upsert({
      where: { sourceUri },
      create: { sourceUri, title, sha256, corpusTag },
      update: { title, sha256, corpusTag },
    });

    const chunks = chunkDocument(content, {
      targetTokens: config.retrieval.chunkTokens,
      overlapTokens: config.retrieval.chunkOverlap,
    });

    const embedded: Array<{ ordinal: number; content: string; tokenCount: number; embedding: number[] }> = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const { vectors } = await embedder.embed(batch.map((c) => ({ text: c.content, kind: "document" as const })));
      batch.forEach((c, j) => {
        embedded.push({ ordinal: c.ordinal, content: c.content, tokenCount: c.tokenEstimate, embedding: vectors[j] ?? [] });
      });
    }

    await store.replaceChunks(doc.id, embedded);
    logger.info({ path, chunks: embedded.length }, "ingested");
    ingested++;
  }

  logger.info({ ingested, skipped, corpusTag }, "ingest complete");
  await prisma.$disconnect();
}

function valueOf(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function firstHeading(md: string): string | undefined {
  return md.split("\n").find((l) => l.startsWith("# "))?.slice(2).trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
