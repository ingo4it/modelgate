import { describe, expect, it, vi } from "vitest";
import { FallbackProvider } from "../../src/model/fallback.js";
import {
  ProviderError,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type StreamEvent,
} from "../../src/model/provider.js";

const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const req: CompletionRequest = { system: "s", user: "u", maxTokens: 100 };
const ok = (model: string): CompletionResult => ({
  text: `from ${model}`,
  model,
  inputTokens: 1,
  outputTokens: 1,
  refused: false,
});

function provider(overrides: Partial<ModelProvider>): ModelProvider {
  return {
    complete: async (m) => ok(m),
    stream: async function* (m) {
      yield { type: "delta", text: `hi from ${m}` } satisfies StreamEvent;
      yield { type: "done", result: ok(m) } satisfies StreamEvent;
    },
    ...overrides,
  };
}

describe("FallbackProvider.complete", () => {
  it("uses the primary when it succeeds", async () => {
    const fb = new FallbackProvider(provider({}), "primary", "secondary", logger);
    const r = await fb.complete(req);
    expect(r.model).toBe("primary");
    expect(r.fellBack).toBe(false);
  });

  it("falls back on a retryable ProviderError", async () => {
    const fb = new FallbackProvider(
      provider({
        complete: async (m) => {
          if (m === "primary") throw new ProviderError("boom", "overloaded", m);
          return ok(m);
        },
      }),
      "primary",
      "secondary",
      logger,
    );
    const r = await fb.complete(req);
    expect(r.model).toBe("secondary");
    expect(r.fellBack).toBe(true);
  });

  it("does not fall back on a bad_request (our bug, not theirs)", async () => {
    const fb = new FallbackProvider(
      provider({
        complete: async (m) => {
          throw new ProviderError("bad", "bad_request", m);
        },
      }),
      "primary",
      "secondary",
      logger,
    );
    await expect(fb.complete(req)).rejects.toMatchObject({ kind: "bad_request" });
  });
});

describe("FallbackProvider.stream", () => {
  it("falls back when the primary fails before the first token", async () => {
    const fb = new FallbackProvider(
      provider({
        stream: async function* (m) {
          if (m === "primary") throw new ProviderError("cold", "timeout", m);
          yield { type: "delta", text: "recovered" };
          yield { type: "done", result: ok(m) };
        },
      }),
      "primary",
      "secondary",
      logger,
    );
    const events = [];
    for await (const e of fb.stream(req)) events.push(e);
    expect(events.some((e) => e.type === "delta" && e.text === "recovered")).toBe(true);
    expect(events.at(-1)!.chosen).toEqual({ model: "secondary", fellBack: true });
  });

  it("surfaces an error if the primary fails after streaming started", async () => {
    const fb = new FallbackProvider(
      provider({
        stream: async function* (m) {
          yield { type: "delta", text: "partial" };
          throw new ProviderError("mid", "transport", m);
        },
      }),
      "primary",
      "secondary",
      logger,
    );
    const run = async () => {
      for await (const _ of fb.stream(req)) void _;
    };
    await expect(run()).rejects.toBeInstanceOf(ProviderError);
  });
});
