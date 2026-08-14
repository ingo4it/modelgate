import { VoyageAIClient } from "voyageai";
import type { RetrievedChunk } from "../core/types.js";

/**
 * Second-stage reranking. Vector search is recall-oriented (fast, approximate);
 * a cross-encoder rerank over the top-K is precision-oriented and cheap at
 * K≈20. The assembler then takes the top-N of *this* ordering.
 */
export interface Reranker {
  rerank(query: string, chunks: RetrievedChunk[], topN: number): Promise<RetrievedChunk[]>;
}

export class VoyageReranker implements Reranker {
  private readonly client: VoyageAIClient;

  constructor(
    apiKey: string,
    private readonly model = "rerank-2",
  ) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async rerank(query: string, chunks: RetrievedChunk[], topN: number): Promise<RetrievedChunk[]> {
    if (chunks.length === 0) return [];
    const res = await this.client.rerank({
      model: this.model,
      query,
      documents: chunks.map((c) => c.content),
      topK: topN,
    });

    return (res.data ?? [])
      .map((r) => {
        const chunk = chunks[r.index ?? 0]!;
        return { ...chunk, rerankScore: r.relevanceScore ?? 0 };
      })
      .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0));
  }
}

/** Order-preserving passthrough: keeps vector-similarity order, takes top-N. */
export class IdentityReranker implements Reranker {
  async rerank(_query: string, chunks: RetrievedChunk[], topN: number): Promise<RetrievedChunk[]> {
    return [...chunks]
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topN)
      .map((c) => ({ ...c, rerankScore: c.similarity }));
  }
}
