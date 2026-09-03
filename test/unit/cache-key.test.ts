import { describe, expect, it } from "vitest";
import { exactCacheKey, normaliseQuestion } from "../../src/cache/key.js";

describe("normaliseQuestion", () => {
  it("collapses casing, whitespace, and trailing punctuation", () => {
    expect(normaliseQuestion("  What  is\tthe Price? ")).toBe("what is the price");
  });
});

describe("exactCacheKey", () => {
  it("is stable across cosmetically different questions", () => {
    const a = exactCacheKey("What is the price?", "claude-sonnet-5", "v1");
    const b = exactCacheKey("what   is the price", "claude-sonnet-5", "v1");
    expect(a).toBe(b);
  });

  it("changes with the model", () => {
    expect(exactCacheKey("q", "claude-sonnet-5", "v1")).not.toBe(exactCacheKey("q", "claude-haiku-4-5", "v1"));
  });

  it("changes with the corpus version (bump = full invalidation)", () => {
    expect(exactCacheKey("q", "claude-sonnet-5", "v1")).not.toBe(exactCacheKey("q", "claude-sonnet-5", "v2"));
  });
});
