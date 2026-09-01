import Anthropic from "@anthropic-ai/sdk";

/**
 * Faithfulness: is every claim in the answer supported by the cited context?
 * This is the one metric that genuinely needs a judge model — string overlap
 * can't tell "the price is $20" from "the price is $200".
 *
 * Production path: `LlmJudge` calls Claude with the answer + the context it was
 * given and asks for a 0..1 support score plus the unsupported claims.
 * Offline / CI path: `HeuristicJudge` approximates with citation density and an
 * abstain check, so the suite runs without spend. The eval report records which
 * judge produced each score.
 */
export type FaithfulnessVerdict = { score: number; unsupported: string[]; judge: string };

export interface FaithfulnessJudge {
  readonly name: string;
  score(args: { answer: string; context: string }): Promise<FaithfulnessVerdict>;
}

export class LlmJudge implements FaithfulnessJudge {
  readonly name = "llm";
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = "claude-sonnet-5",
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async score({ answer, context }: { answer: string; context: string }): Promise<FaithfulnessVerdict> {
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: 500,
      system:
        "You grade whether an ANSWER is fully supported by CONTEXT. Reply with JSON only: " +
        '{"score": <0..1>, "unsupported": ["claim", ...]}. score is the fraction of ' +
        "the answer's factual claims that CONTEXT supports.",
      messages: [{ role: "user", content: `CONTEXT:\n${context}\n\nANSWER:\n${answer}` }],
    });

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text) as { score: number; unsupported: string[] };
    return { score: clamp01(parsed.score), unsupported: parsed.unsupported ?? [], judge: this.name };
  }
}

const ABSTAIN = /\bi (don't|do not) have enough context\b/i;

export class HeuristicJudge implements FaithfulnessJudge {
  readonly name = "heuristic";

  async score({ answer }: { answer: string; context: string }): Promise<FaithfulnessVerdict> {
    if (ABSTAIN.test(answer)) return { score: 1, unsupported: [], judge: this.name };

    const sentences = answer.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    if (sentences.length === 0) return { score: 0, unsupported: ["(empty)"], judge: this.name };

    const cited = sentences.filter((s) => /\[\d{1,2}\]/.test(s));
    const uncited = sentences.filter((s) => !/\[\d{1,2}\]/.test(s));
    return {
      score: clamp01(cited.length / sentences.length),
      unsupported: uncited,
      judge: this.name,
    };
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
