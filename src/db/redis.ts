import { Redis } from "ioredis";

/** Redis holds the exact-match answer cache only. Everything else is Postgres. */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2, enableAutoPipelining: true });
}

export type { Redis };
