import type { Redis } from "ioredis";
import type { Citation } from "../core/types.js";
import { exactCacheKey } from "./key.js";

/**
 * Exact-match response cache in Redis. Cheap first check before the semantic
 * cache and retrieval. Keyed by normalised question + model + corpus version;
 * entries expire by TTL and are wiped wholesale when `CORPUS_VERSION` changes
 * (the version is baked into the key).
 */
export type CachedAnswer = { answer: string; citations: Citation[]; model: string };

export class ExactCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
    private readonly corpusVersion: string,
  ) {}

  async get(question: string, model: string): Promise<CachedAnswer | null> {
    const raw = await this.redis.get(exactCacheKey(question, model, this.corpusVersion));
    return raw ? (JSON.parse(raw) as CachedAnswer) : null;
  }

  async set(question: string, value: CachedAnswer): Promise<void> {
    await this.redis.set(
      exactCacheKey(question, value.model, this.corpusVersion),
      JSON.stringify(value),
      "EX",
      this.ttlSeconds,
    );
  }
}
