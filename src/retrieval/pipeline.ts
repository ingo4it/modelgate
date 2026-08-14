import type { AssembledContext } from "../core/types.js";
import type { Reranker } from "./rerank.js";
import type { VectorSearch } from "./store.js";
import { assembleContext } from "./assemble.js";

/**
 * Retrieval pipeline: ANN search (recall) → rerank (precision) → assemble a
 * token-bounded context block.
 *
 * The query embedding is passed in, not computed here — the answer service
 * embeds the question once and reuses that vector for the semantic cache
 * lookup and for this search, so a cache miss costs one embedding call, not two.
 */
export type RetrievalConfig = {
  topK: number;
  rerankTopN: number;
  contextMaxTokens: number;
  corpusTag?: string;
};

export type RetrievalOutput = {
  context: AssembledContext;
  retrievalMs: number;
  topSimilarity: number;
};

export class RetrievalPipeline {
  constructor(
    private readonly store: VectorSearch,
    private readonly reranker: Reranker,
    private readonly config: RetrievalConfig,
  ) {}

  async retrieve(question: string, queryVector: number[], corpusTag?: string): Promise<RetrievalOutput> {
    const started = performance.now();

    const candidates = await this.store.search(queryVector, {
      topK: this.config.topK,
      corpusTag: corpusTag ?? this.config.corpusTag,
    });

    const ranked = await this.reranker.rerank(question, candidates, this.config.rerankTopN);
    const context = assembleContext(ranked, this.config.contextMaxTokens);

    return {
      context,
      retrievalMs: Math.round(performance.now() - started),
      topSimilarity: candidates[0]?.similarity ?? 0,
    };
  }
}
