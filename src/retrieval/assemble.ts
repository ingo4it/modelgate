import type { AssembledContext, Citation, RetrievedChunk } from "../core/types.js";

/**
 * Turns ranked chunks into a prompt-ready context block with stable citation
 * markers (`[1]`, `[2]`, …). The markers are what the model is told to cite;
 * `citationsFor()` then maps the markers the model actually used back to real
 * documents for the response payload.
 *
 * A token ceiling keeps the context from blowing the budget — chunks are added
 * in rank order until the next one wouldn't fit.
 */
const estTokens = (s: string) => Math.ceil(s.length / 4);

export function assembleContext(chunks: RetrievedChunk[], maxTokens: number): AssembledContext {
  const used: RetrievedChunk[] = [];
  const parts: string[] = [];
  let tokens = 0;

  for (const chunk of chunks) {
    const marker = used.length + 1;
    const block = `[${marker}] (${chunk.title}, part ${chunk.ordinal + 1})\n${chunk.content}`;
    const t = estTokens(block);
    if (tokens + t > maxTokens && used.length > 0) break;
    used.push(chunk);
    parts.push(block);
    tokens += t;
  }

  return { text: parts.join("\n\n---\n\n"), used, tokenEstimate: tokens };
}

/** Map `[n]` markers found in the answer text to citations for the used chunks. */
export function citationsFor(answer: string, used: RetrievedChunk[]): Citation[] {
  const referenced = new Set<number>();
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    referenced.add(Number(m[1]));
  }

  const out: Citation[] = [];
  for (const marker of [...referenced].sort((a, b) => a - b)) {
    const chunk = used[marker - 1];
    if (!chunk) continue;
    out.push({
      documentId: chunk.documentId,
      sourceUri: chunk.sourceUri,
      title: chunk.title,
      ordinal: chunk.ordinal,
      quote: chunk.content.slice(0, 280),
    });
  }
  return out;
}
