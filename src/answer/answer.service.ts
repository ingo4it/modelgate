import type { AnswerResult, Citation } from "../core/types.js";
import type { Config } from "../server/config.js";
import type { Logger } from "../telemetry/logger.js";
import type { Embedder } from "../retrieval/embeddings.js";
import type { RetrievalPipeline } from "../retrieval/pipeline.js";
import type { FallbackProvider } from "../model/fallback.js";
import type { CachedAnswer } from "../cache/exact.js";
import type { SemanticHit } from "../cache/semantic.js";
import type { UsageRecord } from "../usage/events.js";
import { estimateCostUsd } from "../usage/cost.js";

/**
 * Structural ports for the collaborators the service can't unit-test against
 * for real. The concrete `ExactCache` / `SemanticCache` / `UsageRecorder`
 * satisfy these as-is; evals and tests pass in-memory doubles.
 */
export interface ExactCachePort {
  get(question: string, model: string): Promise<CachedAnswer | null>;
  set(question: string, value: CachedAnswer): Promise<void>;
}
export interface SemanticCachePort {
  lookup(questionEmbedding: number[]): Promise<SemanticHit | null>;
  store(args: {
    question: string;
    questionEmbedding: number[];
    answer: string;
    citations: Citation[];
    model: string;
  }): Promise<void>;
}
export interface UsageSink {
  record(rec: UsageRecord): Promise<void>;
}
import { guardInput, guardOutput } from "../guardrails/index.js";
import { Errors } from "../server/errors.js";
import { SYSTEM_PROMPT, buildUserMessage } from "../model/prompt.js";

/**
 * The request pipeline (ADR diagram): input guardrails → exact cache → embed
 * once → semantic cache → retrieve → model (+ fallback) → output guardrails →
 * usage event. Every exit path — cache hit, refusal, no-context — still writes
 * exactly one usage event.
 */
export type AnswerDeps = {
  config: Config;
  logger: Logger;
  embedder: Embedder;
  retrieval: RetrievalPipeline;
  model: FallbackProvider;
  exactCache: ExactCachePort;
  semanticCache: SemanticCachePort;
  usage: UsageSink;
};

const zeroUsage = () => ({
  inputTokens: 0,
  outputTokens: 0,
  embeddingTokens: 0,
  retrievalMs: 0,
  modelMs: 0,
  totalMs: 0,
  costUsd: 0,
});

export class AnswerService {
  constructor(private readonly d: AnswerDeps) {}

  async answer(rawQuestion: unknown, requestId: string, corpusTag?: string): Promise<AnswerResult> {
    const startedAt = performance.now();
    const { config } = this.d;
    const primary = config.model.primary;

    const { text: question } = guardInput(
      rawQuestion,
      { maxChars: config.guardrails.maxQuestionChars },
      this.d.logger,
    );

    // 1. exact cache
    const exact = await this.d.exactCache.get(question, primary);
    if (exact) {
      return this.finish(requestId, "answer", question, {
        answer: exact.answer,
        citations: exact.citations,
        model: exact.model,
        requestedModel: primary,
        fellBack: false,
        cacheOutcome: "exact",
        refused: false,
        usage: { ...zeroUsage(), totalMs: Math.round(performance.now() - startedAt) },
      });
    }

    // 2. embed once — used for the semantic cache and for retrieval
    const embed = await this.d.embedder.embed([{ text: question, kind: "query" }]);
    const queryVector = embed.vectors[0];
    if (!queryVector) throw Errors.outputInvalid("embedder returned no vector");

    // 3. semantic cache
    const semantic = await this.d.semanticCache.lookup(queryVector);
    if (semantic) {
      this.d.logger.debug({ requestId, similarity: semantic.similarity }, "semantic cache hit");
      return this.finish(requestId, "answer", question, {
        answer: semantic.answer,
        citations: semantic.citations,
        model: semantic.model,
        requestedModel: primary,
        fellBack: false,
        cacheOutcome: "semantic",
        refused: false,
        usage: {
          ...zeroUsage(),
          embeddingTokens: embed.tokens,
          costUsd: estimateCostUsd({
            model: "none",
            inputTokens: 0,
            outputTokens: 0,
            embeddingModel: this.d.embedder.model,
            embeddingTokens: embed.tokens,
          }),
          totalMs: Math.round(performance.now() - startedAt),
        },
      });
    }

    // 4. retrieve
    const retrieval = await this.d.retrieval.retrieve(question, queryVector, corpusTag);
    if (retrieval.context.used.length === 0) {
      // nothing relevant — bill the embedding, don't call the model
      await this.d.usage.record({
        requestId,
        route: "answer",
        question,
        result: {
          model: "none",
          requestedModel: primary,
          fellBack: false,
          cacheOutcome: "miss",
          refused: false,
          usage: {
            ...zeroUsage(),
            embeddingTokens: embed.tokens,
            retrievalMs: retrieval.retrievalMs,
            totalMs: Math.round(performance.now() - startedAt),
          },
        },
      });
      throw Errors.noContext();
    }

    // 5. model (+ fallback)
    const modelStarted = performance.now();
    const completion = await this.d.model.complete({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(question, retrieval.context.text),
      maxTokens: config.model.maxTokens,
    });
    const modelMs = Math.round(performance.now() - modelStarted);

    // 6. output guardrails
    const guarded = guardOutput({
      rawAnswer: completion.text,
      refused: completion.refused,
      refusalCategory: completion.refusalCategory,
      usedChunks: retrieval.context.used,
    });
    if (guarded.uncited) {
      this.d.logger.warn({ requestId }, "answer had no valid citations");
    }

    const costUsd = estimateCostUsd({
      model: completion.model,
      inputTokens: completion.inputTokens,
      outputTokens: completion.outputTokens,
      embeddingModel: this.d.embedder.model,
      embeddingTokens: embed.tokens,
    });

    const result: AnswerResult = {
      answer: guarded.answer,
      citations: guarded.citations,
      model: completion.model,
      requestedModel: primary,
      fellBack: completion.fellBack,
      cacheOutcome: "miss",
      refused: false,
      usage: {
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        embeddingTokens: embed.tokens,
        retrievalMs: retrieval.retrievalMs,
        modelMs,
        totalMs: Math.round(performance.now() - startedAt),
        costUsd,
      },
    };

    // 7. populate caches (best effort; don't cache uncited or fallback answers)
    if (!guarded.uncited && !completion.fellBack) {
      await Promise.allSettled([
        this.d.exactCache.set(question, {
          answer: result.answer,
          citations: result.citations,
          model: result.model,
        }),
        this.d.semanticCache.store({
          question,
          questionEmbedding: queryVector,
          answer: result.answer,
          citations: result.citations,
          model: result.model,
        }),
      ]);
    }

    return this.finish(requestId, "answer", question, result);
  }

  /**
   * Streaming variant. Yields SSE-ready events; the route serialises them.
   * Guardrails, retrieval, fallback, and usage accounting are identical to
   * `answer()` — only the model call streams. The response caches are *not*
   * consulted here: a streamed request is treated as an explicit ask for a
   * fresh generation, and replaying a cached answer as fake token deltas isn't
   * worth the added event-contract complexity. (Serving cache hits on the
   * stream endpoint is on the roadmap.)
   */
  async *answerStream(
    rawQuestion: unknown,
    requestId: string,
    opts: { signal?: AbortSignal; corpusTag?: string } = {},
  ): AsyncGenerator<AnswerStreamEvent> {
    const startedAt = performance.now();
    const { config } = this.d;
    const primary = config.model.primary;
    const question = guardInput(
      rawQuestion,
      { maxChars: config.guardrails.maxQuestionChars },
      this.d.logger,
    ).text;

    const embed = await this.d.embedder.embed([{ text: question, kind: "query" }]);
    const queryVector = embed.vectors[0];
    if (!queryVector) throw Errors.outputInvalid("embedder returned no vector");

    const retrieval = await this.d.retrieval.retrieve(question, queryVector, opts.corpusTag);
    if (retrieval.context.used.length === 0) throw Errors.noContext();
    yield { type: "meta", retrievalMs: retrieval.retrievalMs, contextChunks: retrieval.context.used.length };

    const modelStarted = performance.now();
    let accumulated = "";
    let chosen = { model: primary, fellBack: false };
    let usage = { inputTokens: 0, outputTokens: 0 };
    let refused: { category?: string } | null = null;

    for await (const ev of this.d.model.stream(
      {
        system: SYSTEM_PROMPT,
        user: buildUserMessage(question, retrieval.context.text),
        maxTokens: config.model.maxTokens,
      },
      opts.signal,
    )) {
      chosen = ev.chosen;
      if (ev.type === "delta") {
        accumulated += ev.text;
        yield { type: "delta", text: ev.text };
      } else if (ev.type === "refusal") {
        refused = { category: ev.category };
      } else if (ev.type === "done") {
        usage = { inputTokens: ev.result.inputTokens, outputTokens: ev.result.outputTokens };
      }
    }

    const guarded = guardOutput({
      rawAnswer: accumulated,
      refused: refused !== null,
      refusalCategory: refused?.category,
      usedChunks: retrieval.context.used,
    });

    const costUsd = estimateCostUsd({
      model: chosen.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      embeddingModel: this.d.embedder.model,
      embeddingTokens: embed.tokens,
    });

    const result: AnswerResult = {
      answer: guarded.answer,
      citations: guarded.citations,
      model: chosen.model,
      requestedModel: primary,
      fellBack: chosen.fellBack,
      cacheOutcome: "miss",
      refused: false,
      usage: {
        ...usage,
        embeddingTokens: embed.tokens,
        retrievalMs: retrieval.retrievalMs,
        modelMs: Math.round(performance.now() - modelStarted),
        totalMs: Math.round(performance.now() - startedAt),
        costUsd,
      },
    };

    if (!guarded.uncited && !chosen.fellBack) {
      await Promise.allSettled([
        this.d.exactCache.set(question, {
          answer: result.answer,
          citations: result.citations,
          model: result.model,
        }),
        this.d.semanticCache.store({
          question,
          questionEmbedding: queryVector,
          answer: result.answer,
          citations: result.citations,
          model: result.model,
        }),
      ]);
    }

    await this.d.usage.record({ requestId, route: "answer.stream", question, result });
    yield {
      type: "final",
      citations: guarded.citations,
      usage: result.usage,
      model: result.model,
      fellBack: result.fellBack,
    };
  }

  private async finish(
    requestId: string,
    route: "answer" | "answer.stream",
    question: string,
    result: AnswerResult,
  ): Promise<AnswerResult> {
    await this.d.usage.record({ requestId, route, question, result });
    return result;
  }
}

export type AnswerStreamEvent =
  | { type: "meta"; retrievalMs: number; contextChunks: number }
  | { type: "delta"; text: string }
  | { type: "final"; citations: Citation[]; usage: AnswerResult["usage"]; model: string; fellBack: boolean };
