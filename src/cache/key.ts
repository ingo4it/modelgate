import { createHash } from "node:crypto";

/**
 * Normalisation for exact-match cache keys. Two questions that differ only in
 * casing, whitespace, or a trailing "?" should hit the same cache entry; two
 * that differ in a meaningful word should not. The model id and the corpus
 * version are part of the key so a prompt change or a re-ingest (bump
 * `CORPUS_VERSION`) invalidates every entry at once.
 */
export function normaliseQuestion(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?.!,;:]+$/g, "");
}

export function exactCacheKey(question: string, model: string, corpusVersion: string): string {
  const digest = createHash("sha256")
    .update(normaliseQuestion(question))
    .update("|")
    .update(model)
    .update("|")
    .update(corpusVersion)
    .digest("hex");
  return `mg:ans:${digest}`;
}
