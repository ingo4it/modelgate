import type { Embedder } from "../../src/retrieval/embeddings.js";

/**
 * Answer relevance: cosine similarity between the produced answer and the
 * reference answer, in embedding space. Cheap, deterministic, and catches
 * off-topic or empty answers. It does NOT catch a fluent answer that's subtly
 * wrong — that's what faithfulness is for.
 *
 * `mustContain` is an optional hard gate: if the case lists required phrases and
 * any is missing, relevance is capped at 0.5 regardless of cosine.
 */
export async function answerRelevance(
  embedder: Embedder,
  answer: string,
  reference: string,
  mustContain: string[] = [],
): Promise<number> {
  const missing = mustContain.filter((p) => !answer.toLowerCase().includes(p.toLowerCase()));

  const { vectors } = await embedder.embed([
    { text: answer, kind: "query" },
    { text: reference, kind: "query" },
  ]);
  const cos = cosine(vectors[0] ?? [], vectors[1] ?? []);

  return missing.length > 0 ? Math.min(cos, 0.5) : cos;
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
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
