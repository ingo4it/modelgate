import { Errors } from "../server/errors.js";
import { scanForInjection } from "./injection.js";
import type { Logger } from "../telemetry/logger.js";

/**
 * Input guardrails: run before anything is embedded or sent to a model.
 * Rejects malformed or oversized questions and the obvious prompt-injection
 * class. A flagged-but-not-rejected question (weak signal) is logged and lets
 * through — the fixed system prompt and quoted context are the real defence.
 */
export type InputGuardConfig = { maxChars: number };

export type CleanQuestion = { text: string; injectionReasons: string[] };

// control chars other than tab / newline / carriage-return
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

export function guardInput(raw: unknown, cfg: InputGuardConfig, logger: Logger): CleanQuestion {
  if (typeof raw !== "string") throw Errors.badQuestion("question must be a string");

  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length === 0) throw Errors.badQuestion("question is empty");
  if (text.length > cfg.maxChars) {
    throw Errors.badQuestion(`question exceeds ${cfg.maxChars} characters`);
  }
  if (CONTROL_CHARS.test(raw)) {
    throw Errors.badQuestion("question contains control characters");
  }

  const injection = scanForInjection(text);
  if (injection.flagged) {
    logger.warn({ reasons: injection.reasons }, "input guardrail: injection patterns matched");
    throw Errors.promptInjection(`matched: ${injection.reasons.join(", ")}`);
  }

  return { text, injectionReasons: injection.reasons };
}
