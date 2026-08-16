/**
 * Model-provider abstraction. The answer service talks to this, never to the
 * Anthropic SDK directly, so:
 *   - the fallback policy can wrap any provider (see `fallback.ts`)
 *   - the eval + unit suites run against `FixtureProvider` with recorded
 *     responses, deterministically and offline
 */
export type CompletionRequest = {
  system: string;
  user: string;
  maxTokens: number;
};

export type Usage = { inputTokens: number; outputTokens: number };

export type CompletionResult = Usage & {
  text: string;
  model: string;
  /** true when the model declined (Anthropic `stop_reason: "refusal"`) */
  refused: boolean;
  refusalCategory?: string;
};

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "refusal"; category?: string }
  | { type: "done"; result: CompletionResult };

export interface ModelProvider {
  complete(model: string, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult>;
  stream(model: string, req: CompletionRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent>;
}

/** Thrown for transport/rate-limit/5xx failures — the signal to fall back. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "timeout" | "rate_limit" | "overloaded" | "transport" | "bad_request",
    readonly model: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable(): boolean {
    return this.kind !== "bad_request";
  }
}
