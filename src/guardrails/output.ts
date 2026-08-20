import type { Citation, RetrievedChunk } from "../core/types.js";
import { Errors } from "../server/errors.js";
import { citationsFor } from "../retrieval/assemble.js";
import { redactPii, type PiiFinding } from "./pii.js";

/**
 * Output guardrails: run on the model's answer before it reaches the client.
 *
 *  1. Refusal → surface as a 422, don't dress it up as an answer.
 *  2. Empty answer → 502; the model produced nothing usable.
 *  3. Citation integrity → every `[n]` marker must map to a chunk that was
 *     actually in context. Markers pointing nowhere are stripped.
 *  4. Groundedness → a substantive answer with zero valid citations is flagged
 *     `uncited`. The "abstain" answer (I don't know / not in the context) is
 *     allowed to be uncited.
 *  5. PII → redact from the answer as defence-in-depth.
 */
export type GuardedOutput = {
  answer: string;
  citations: Citation[];
  uncited: boolean;
  piiFindings: PiiFinding[];
};

const ABSTAIN = /\b(i (don't|do not) (have|know)|not (in|covered by|found in) the (provided )?context|cannot answer)\b/i;

export function guardOutput(args: {
  rawAnswer: string;
  refused: boolean;
  refusalCategory?: string;
  usedChunks: RetrievedChunk[];
}): GuardedOutput {
  if (args.refused) {
    throw Errors.refused(args.refusalCategory ? `category: ${args.refusalCategory}` : "no category given");
  }

  const trimmed = args.rawAnswer.trim();
  if (trimmed.length === 0) throw Errors.outputInvalid("model returned an empty answer");

  // strip citation markers that don't correspond to a chunk in context
  const validMarkers = new Set(args.usedChunks.map((_, i) => i + 1));
  const cleaned = trimmed.replace(/\[(\d{1,2})\]/g, (m, n: string) =>
    validMarkers.has(Number(n)) ? m : "",
  );

  const { text: redacted, findings } = redactPii(cleaned.replace(/\s{2,}/g, " ").trim());
  const citations = citationsFor(redacted, args.usedChunks);
  const uncited = citations.length === 0 && !ABSTAIN.test(redacted);

  return { answer: redacted, citations, uncited, piiFindings: findings };
}
