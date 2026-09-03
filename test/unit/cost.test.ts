import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../../src/usage/cost.js";

describe("estimateCostUsd", () => {
  it("prices a Sonnet 5 call at the published rates", () => {
    // 1M input @ $2, 1M output @ $10
    const cost = estimateCostUsd({
      model: "claude-sonnet-5",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      embeddingModel: "fixture-embed",
      embeddingTokens: 0,
    });
    expect(cost).toBeCloseTo(12, 6);
  });

  it("adds the embedding cost", () => {
    const cost = estimateCostUsd({
      model: "claude-haiku-4-5",
      inputTokens: 0,
      outputTokens: 0,
      embeddingModel: "voyage-3",
      embeddingTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.06, 6);
  });

  it("treats an unknown model as zero model cost (cache hits, no-context)", () => {
    const cost = estimateCostUsd({
      model: "none",
      inputTokens: 999,
      outputTokens: 999,
      embeddingModel: "voyage-3",
      embeddingTokens: 500_000,
    });
    expect(cost).toBeCloseTo(0.03, 6);
  });
});
