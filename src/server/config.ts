import { z } from "zod";

/** Parsed once at boot, frozen. Nothing else reads process.env. */
const schema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  port: z.coerce.number().int().positive().default(8000),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  databaseUrl: z.string().url(),
  redisUrl: z.string().url(),

  model: z.object({
    apiKey: z.string().min(1),
    primary: z.string().default("claude-sonnet-5"),
    fallback: z.string().default("claude-haiku-4-5"),
    maxTokens: z.coerce.number().int().positive().default(1024),
    timeoutMs: z.coerce.number().int().positive().default(8000),
  }),

  embedding: z.object({
    apiKey: z.string().min(1),
    model: z.string().default("voyage-3"),
    dim: z.coerce.number().int().positive().default(1024),
  }),

  retrieval: z.object({
    topK: z.coerce.number().int().positive().default(20),
    rerankTopN: z.coerce.number().int().positive().default(5),
    chunkTokens: z.coerce.number().int().positive().default(400),
    chunkOverlap: z.coerce.number().int().nonnegative().default(64),
  }),

  cache: z.object({
    exactTtlSeconds: z.coerce.number().int().positive().default(86400),
    semanticTtlSeconds: z.coerce.number().int().positive().default(3600),
    semanticMinSimilarity: z.coerce.number().min(0).max(1).default(0.97),
    corpusVersion: z.string().default("dev"),
  }),

  guardrails: z.object({
    maxQuestionChars: z.coerce.number().int().positive().default(1200),
  }),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    model: {
      apiKey: env.ANTHROPIC_API_KEY,
      primary: env.MODEL_PRIMARY,
      fallback: env.MODEL_FALLBACK,
      maxTokens: env.MODEL_MAX_TOKENS,
      timeoutMs: env.MODEL_TIMEOUT_MS,
    },
    embedding: {
      apiKey: env.VOYAGE_API_KEY,
      model: env.EMBEDDING_MODEL,
      dim: env.EMBEDDING_DIM,
    },
    retrieval: {
      topK: env.RETRIEVAL_TOP_K,
      rerankTopN: env.RERANK_TOP_N,
      chunkTokens: env.CHUNK_TOKENS,
      chunkOverlap: env.CHUNK_OVERLAP,
    },
    cache: {
      exactTtlSeconds: env.EXACT_CACHE_TTL,
      semanticTtlSeconds: env.SEMANTIC_CACHE_TTL,
      semanticMinSimilarity: env.SEMANTIC_CACHE_MIN_SIMILARITY,
      corpusVersion: env.CORPUS_VERSION,
    },
    guardrails: {
      maxQuestionChars: env.MAX_QUESTION_CHARS,
    },
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return Object.freeze(parsed.data);
}
