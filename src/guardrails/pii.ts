/**
 * Lightweight PII detection / redaction. Applied to the model *output* as
 * defence-in-depth (the corpus shouldn't contain PII, but if a chunk does and
 * the model quotes it, this scrubs it) and available for redacting logs.
 *
 * Precision over recall on purpose: better to miss an edge case than to mangle
 * a legitimate answer. Redaction preserves the category so a reader knows
 * something was removed.
 */
const RULES: Array<{ type: string; re: RegExp }> = [
  { type: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "PHONE", re: /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]?\d{3,4}(?!\d)/g },
  { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "CARD", re: /\b(?:\d[ -]?){13,16}\b/g },
  { type: "IP", re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

export type PiiFinding = { type: string; count: number };

export function scanPii(text: string): PiiFinding[] {
  const out: PiiFinding[] = [];
  for (const rule of RULES) {
    const count = (text.match(rule.re) ?? []).length;
    if (count > 0) out.push({ type: rule.type, count });
  }
  return out;
}

export function redactPii(text: string): { text: string; findings: PiiFinding[] } {
  const findings = scanPii(text);
  let redacted = text;
  for (const rule of RULES) {
    redacted = redacted.replace(rule.re, `[redacted:${rule.type.toLowerCase()}]`);
  }
  return { text: redacted, findings };
}
