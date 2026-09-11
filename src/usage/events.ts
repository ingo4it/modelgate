import type { PrismaClient } from "@prisma/client";
import type { AnswerResult, CacheOutcome } from "../core/types.js";
import type { Logger } from "../telemetry/logger.js";

/**
 * Every answer request — cached or not, refused or not — writes exactly one
 * `UsageEvent`. That table is the source of truth for the cost/latency
 * dashboard and the CI cost report. Writing it must never fail the request, so
 * errors here are logged and swallowed.
 */
export type UsageRecord = {
  requestId: string;
  route: "answer" | "answer.stream";
  question: string;
  result: Pick<AnswerResult, "model" | "requestedModel" | "fellBack" | "cacheOutcome" | "refused" | "usage">;
};

export class UsageRecorder {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async record(rec: UsageRecord): Promise<void> {
    const u = rec.result.usage;
    try {
      await this.prisma.usageEvent.create({
        data: {
          requestId: rec.requestId,
          route: rec.route,
          question: rec.question.slice(0, 2000),
          model: rec.result.model,
          requestedModel: rec.result.requestedModel,
          fellBack: rec.result.fellBack,
          cacheOutcome: rec.result.cacheOutcome,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          embeddingTokens: u.embeddingTokens,
          retrievalMs: u.retrievalMs,
          modelMs: u.modelMs,
          totalMs: u.totalMs,
          costUsd: u.costUsd,
          refused: rec.result.refused,
        },
      });
    } catch (err) {
      this.logger.error({ err, requestId: rec.requestId }, "failed to record usage event");
    }
  }

  /** Rollup for `GET /v1/usage/summary` and the CI cost report. */
  async summary(sinceHours = 24): Promise<UsageSummary> {
    const since = new Date(Date.now() - sinceHours * 3600_000);
    const rows = await this.prisma.usageEvent.findMany({
      where: { createdAt: { gte: since } },
      select: {
        cacheOutcome: true,
        fellBack: true,
        refused: true,
        costUsd: true,
        totalMs: true,
        outputTokens: true,
      },
      orderBy: { totalMs: "asc" },
    });

    const n = rows.length || 1;
    const cacheHits = rows.filter((r) => r.cacheOutcome !== "miss").length;
    const latencies = rows.map((r) => r.totalMs);
    const cost = rows.reduce((s, r) => s + Number(r.costUsd), 0);

    return {
      windowHours: sinceHours,
      requests: rows.length,
      cacheHitRate: round(cacheHits / n),
      fallbackRate: round(rows.filter((r) => r.fellBack).length / n),
      refusalRate: round(rows.filter((r) => r.refused).length / n),
      p50LatencyMs: percentile(latencies, 0.5),
      p95LatencyMs: percentile(latencies, 0.95),
      costUsd: round(cost),
      costPer1kRequests: round((cost / n) * 1000),
    };
  }
}

export type UsageSummary = {
  windowHours: number;
  requests: number;
  cacheHitRate: number;
  fallbackRate: number;
  refusalRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  costUsd: number;
  costPer1kRequests: number;
};

const round = (n: number) => Math.round(n * 1e4) / 1e4;

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx]!;
}

export type { CacheOutcome };
