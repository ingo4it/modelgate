import type { RetrievedChunk } from "../../src/core/types.js";

/**
 * Retrieval hit-rate @k: of the sources a case says are needed, how many showed
 * up in the top-k retrieved chunks. A pure set operation — no model, no
 * subjectivity. This is the metric that tells you whether a bad answer is a
 * retrieval problem or a generation problem.
 *
 * `expectedSources` are matched as case-insensitive substrings against each
 * chunk's `sourceUri` and `title`, so a case can name `"pricing.md"` without
 * knowing the absolute path.
 */
export function hitRateAtK(retrieved: RetrievedChunk[], expectedSources: string[], k: number): number {
  if (expectedSources.length === 0) return 1;
  const topK = retrieved.slice(0, k);
  const found = expectedSources.filter((want) => {
    const needle = want.toLowerCase();
    return topK.some(
      (c) => c.sourceUri.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle),
    );
  });
  return found.length / expectedSources.length;
}
