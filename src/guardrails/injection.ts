/**
 * Prompt-injection heuristics for the *input* question. This is a cheap
 * first-pass filter, not a security boundary — the real defence is that the
 * retrieved context is quoted, never executed, and the system prompt is fixed.
 * It catches the obvious "ignore your instructions" class and logs the rest.
 */
const PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "override_instructions", re: /\b(ignore|disregard|forget|override)\b.{0,30}\b(previous|prior|above|earlier|all)\b.{0,20}\b(instructions?|prompts?|rules?|context)\b/i },
  { id: "reveal_system_prompt", re: /\b(show|print|reveal|repeat|output)\b.{0,20}\b(system|developer)\b.{0,10}\bprompt\b/i },
  { id: "role_injection", re: /^\s*(system|assistant|developer)\s*:/im },
  { id: "delimiter_break", re: /(<\/?(system|instructions?|context)>|```system|\[\/?INST\])/i },
  { id: "exfiltrate", re: /\b(base64|rot13|hex)\b.{0,20}\b(the|your|all)\b.{0,20}\b(instructions?|prompt|context)\b/i },
];

export type InjectionScan = { flagged: boolean; reasons: string[] };

export function scanForInjection(text: string): InjectionScan {
  const reasons = PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  return { flagged: reasons.length > 0, reasons };
}
