import { readdir, readFile } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import type { RetrievedChunk } from "../../src/core/types.js";
import type { VectorSearch } from "../../src/retrieval/store.js";
import type { Embedder } from "../../src/retrieval/embeddings.js";
import { chunkDocument } from "../../src/retrieval/chunk.js";

/**
 * In-memory vector store for the eval harness (and unit tests). Same contract
 * as the real pgvector-backed `VectorStore`, brute-force cosine over a few
 * hundred chunks — fine at corpus-sample scale, and it needs no database.
 */
type Entry = RetrievedChunk & { embedding: number[] };

export class MemoryVectorStore implements VectorSearch {
  private entries: Entry[] = [];

  async loadCorpus(dir: string, embedder: Embedder, opts: { targetTokens: number; overlapTokens: number }): Promise<void> {
    for (const name of await readdir(dir)) {
      if (![".md", ".txt"].includes(extname(name))) continue;
      const content = await readFile(join(dir, name), "utf8");
      const title = content.split("\n").find((l) => l.startsWith("# "))?.slice(2).trim() ?? basename(name);
      const chunks = chunkDocument(content, opts);
      const { vectors } = await embedder.embed(chunks.map((c) => ({ text: c.content, kind: "document" as const })));
      chunks.forEach((c, i) => {
        this.entries.push({
          chunkId: `${name}#${c.ordinal}`,
          documentId: name,
          sourceUri: `file://${name}`,
          title,
          ordinal: c.ordinal,
          content: c.content,
          similarity: 0,
          embedding: vectors[i] ?? [],
        });
      });
    }
  }

  async search(queryVector: number[], opts: { topK: number; corpusTag?: string }): Promise<RetrievedChunk[]> {
    return this.entries
      .map((e) => ({ ...e, similarity: cosine(queryVector, e.embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, opts.topK)
      .map(({ embedding: _drop, ...rest }) => rest);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}
