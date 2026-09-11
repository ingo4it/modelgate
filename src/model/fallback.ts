import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type StreamEvent,
} from "./provider.js";
import type { Logger } from "../telemetry/logger.js";

/**
 * Fallback policy (ADR-0003). Wraps any `ModelProvider`:
 *
 *   - `complete`: try `primary`; on a *retryable* ProviderError (timeout / rate
 *     limit / overloaded / transport) try `fallback` once. A `bad_request` is
 *     not retried — it's our bug, not the provider's.
 *   - `stream`: fall back only if `primary` fails *before the first token*.
 *     Once bytes are on the wire we can't cleanly restart, so a mid-stream
 *     failure surfaces as an error and the caller ends the SSE stream.
 *
 * The chosen model and whether a downgrade happened are reported on the result
 * so `UsageEvent.fellBack` is always accurate.
 */
export type ChosenModel = { model: string; fellBack: boolean };

export class FallbackProvider {
  constructor(
    private readonly inner: ModelProvider,
    private readonly primary: string,
    private readonly fallback: string,
    private readonly logger: Logger,
  ) {}

  async complete(req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult & ChosenModel> {
    try {
      const result = await this.inner.complete(this.primary, req, signal);
      return { ...result, model: this.primary, fellBack: false };
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable) throw err;
      this.logger.warn({ from: this.primary, to: this.fallback, kind: err.kind }, "model fallback");
      const result = await this.inner.complete(this.fallback, req, signal);
      return { ...result, model: this.fallback, fellBack: true };
    }
  }

  async *stream(
    req: CompletionRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent & { chosen: ChosenModel }> {
    const attempt = async function* (
      this: FallbackProvider,
      model: string,
      fellBack: boolean,
    ): AsyncGenerator<StreamEvent & { chosen: ChosenModel }> {
      for await (const event of this.inner.stream(model, req, signal)) {
        yield { ...event, chosen: { model, fellBack } };
      }
    }.bind(this);

    let started = false;
    try {
      for await (const event of attempt(this.primary, false)) {
        started ||= event.type === "delta";
        yield event;
      }
    } catch (err) {
      if (started || !(err instanceof ProviderError) || !err.retryable) throw err;
      this.logger.warn(
        { from: this.primary, to: this.fallback, kind: err.kind },
        "model fallback (pre-stream)",
      );
      yield* attempt(this.fallback, true);
    }
  }
}
