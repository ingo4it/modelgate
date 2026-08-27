import type { Config } from "./config.js";
import type { Deps } from "./context.js";
import { createLogger } from "../telemetry/logger.js";
import { createPrisma } from "../db/client.js";
import { createRedis } from "../db/redis.js";
import { VoyageEmbedder } from "../retrieval/embeddings.js";
import { VectorStore } from "../retrieval/store.js";
import { VoyageReranker } from "../retrieval/rerank.js";
import { RetrievalPipeline } from "../retrieval/pipeline.js";
import { AnthropicProvider } from "../model/anthropic.js";
import { FallbackProvider } from "../model/fallback.js";
import { ExactCache } from "../cache/exact.js";
import { SemanticCache } from "../cache/semantic.js";
import { UsageRecorder } from "../usage/events.js";
import { AnswerService } from "../answer/answer.service.js";

/**
 * Composition root. Wires the real (network-backed) implementations. Tests
 * assemble `AnswerService` directly with fixture doubles and never touch this.
 */
export function createDeps(config: Config): Deps {
  const logger = createLogger(config);
  const prisma = createPrisma(config.databaseUrl);
  const redis = createRedis(config.redisUrl);

  const embedder = new VoyageEmbedder(config.embedding.apiKey, config.embedding.model, config.embedding.dim);
  const store = new VectorStore(prisma);
  const reranker = new VoyageReranker(config.embedding.apiKey);

  const retrieval = new RetrievalPipeline(store, reranker, {
    topK: config.retrieval.topK,
    rerankTopN: config.retrieval.rerankTopN,
    // leave headroom under the model context for the system prompt + answer
    contextMaxTokens: 6000,
  });

  const model = new FallbackProvider(
    new AnthropicProvider(config.model.apiKey, config.model.timeoutMs),
    config.model.primary,
    config.model.fallback,
    logger,
  );

  const exactCache = new ExactCache(redis, config.cache.exactTtlSeconds, config.cache.corpusVersion);
  const semanticCache = new SemanticCache(prisma, {
    minSimilarity: config.cache.semanticMinSimilarity,
    ttlSeconds: config.cache.semanticTtlSeconds,
    corpusVersion: config.cache.corpusVersion,
  });
  const usage = new UsageRecorder(prisma, logger);

  const answers = new AnswerService({
    config,
    logger,
    embedder,
    retrieval,
    model,
    exactCache,
    semanticCache,
    usage,
  });

  return { config, logger, prisma, redis, answers, usage, semanticCache };
}

export async function closeDeps(deps: Deps): Promise<void> {
  await deps.prisma.$disconnect();
  deps.redis.disconnect();
}
