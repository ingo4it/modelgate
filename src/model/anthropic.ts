import Anthropic from "@anthropic-ai/sdk";
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type StreamEvent,
} from "./provider.js";

/**
 * Anthropic-backed provider.
 *
 * `max_tokens` is deliberately small (config `MODEL_MAX_TOKENS`, default 1024):
 * this is a grounded-answer service, not a long-form generator, and a tight cap
 * bounds both latency and cost. Thinking is left at the model default —
 * `claude-sonnet-5` runs adaptive thinking, the `claude-haiku-4-5` fallback
 * doesn't, which is the right tradeoff for a degraded path.
 *
 * Refusals are not exceptions: the API returns HTTP 200 with
 * `stop_reason: "refusal"`. Callers must check `result.refused`.
 */
export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;

  constructor(apiKey: string, timeoutMs: number) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  }

  async complete(model: string, req: CompletionRequest, signal?: AbortSignal): Promise<CompletionResult> {
    try {
      const message = await this.client.messages.create(
        {
          model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
        },
        { signal },
      );

      if (message.stop_reason === "refusal") {
        return {
          text: "",
          model,
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
          refused: true,
          refusalCategory: message.stop_details?.category ?? undefined,
        };
      }

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      return {
        text,
        model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        refused: false,
      };
    } catch (err) {
      throw toProviderError(err, model);
    }
  }

  async *stream(model: string, req: CompletionRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const stream = this.client.messages.stream(
      {
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      },
      { signal },
    );

    try {
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "delta", text: event.delta.text };
        }
      }

      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") {
        yield { type: "refusal", category: final.stop_details?.category ?? undefined };
      }
      yield {
        type: "done",
        result: {
          text: final.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join(""),
          model,
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
          refused: final.stop_reason === "refusal",
          refusalCategory: final.stop_details?.category ?? undefined,
        },
      };
    } catch (err) {
      throw toProviderError(err, model);
    }
  }
}

function toProviderError(err: unknown, model: string): ProviderError {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderError("model call timed out", "timeout", model);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError("model rate limited", "rate_limit", model);
  }
  if (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503)) {
    return new ProviderError("model overloaded", "overloaded", model);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ProviderError(err.message, "bad_request", model);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError("model connection error", "transport", model);
  }
  return new ProviderError((err as Error).message ?? "unknown model error", "transport", model);
}
