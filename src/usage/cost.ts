/**
 * Price book, USD per 1M tokens. Anthropic first-party API rates (see
 * docs.anthropic.com/pricing) plus the Voyage embedding rate. Update here when
 * prices change — nothing else hard-codes a number.
 *
 * These are list prices used for *attribution*, not billing. The dashboard
 * shows cost/1k-requests from the sum of `UsageEvent.costUsd`.
 */
export type Price = { inputPerM: number; outputPerM: number };

export const MODEL_PRICES: Record<string, Price> = {
  "claude-opus-5": { inputPerM: 5, outputPerM: 25 },
  "claude-sonnet-5": { inputPerM: 2, outputPerM: 10 },
  "claude-haiku-4-5": { inputPerM: 1, outputPerM: 5 },
};

/** Voyage embeddings are billed per input token; output is the vector. */
export const EMBEDDING_PRICE_PER_M: Record<string, number> = {
  "voyage-3": 0.06,
  "voyage-3-lite": 0.02,
  "fixture-embed": 0,
};

export type CostInputs = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  embeddingModel: string;
  embeddingTokens: number;
};

export function estimateCostUsd(x: CostInputs): number {
  const model = MODEL_PRICES[x.model];
  const embed = EMBEDDING_PRICE_PER_M[x.embeddingModel] ?? 0;

  const modelCost = model
    ? (x.inputTokens * model.inputPerM + x.outputTokens * model.outputPerM) / 1_000_000
    : 0;
  const embedCost = (x.embeddingTokens * embed) / 1_000_000;

  return round8(modelCost + embedCost);
}

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
