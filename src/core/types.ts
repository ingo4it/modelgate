/** Shared domain types. Kept dependency-free so every layer can import them. */

export type Citation = {
  documentId: string;
  sourceUri: string;
  title: string;
  /** chunk position within the document */
  ordinal: number;
  /** the span of chunk text the answer leaned on */
  quote: string;
};

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  sourceUri: string;
  title: string;
  ordinal: number;
  content: string;
  /** cosine similarity from the vector search, 0..1 */
  similarity: number;
  /** cross-encoder score after rerank, if reranked */
  rerankScore?: number;
};

export type AssembledContext = {
  /** the prompt-ready context block, with per-chunk citation markers */
  text: string;
  /** chunks actually included, in prompt order */
  used: RetrievedChunk[];
  tokenEstimate: number;
};

export type CacheOutcome = "miss" | "exact" | "semantic";

export type AnswerResult = {
  answer: string;
  citations: Citation[];
  model: string;
  requestedModel: string;
  fellBack: boolean;
  cacheOutcome: CacheOutcome;
  refused: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    retrievalMs: number;
    modelMs: number;
    totalMs: number;
    costUsd: number;
  };
};
