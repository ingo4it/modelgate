import type { FastifyInstance } from "fastify";

/**
 * `/healthz` — liveness, no downstream checks.
 * `/readyz`  — readiness: Postgres + Redis reachable.
 * groundwork's ECS module points its container health check at `/healthz`.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => ({ status: "ok", uptime: Math.round(process.uptime()) }));

  app.get("/readyz", async (_req, reply) => {
    const checks = await Promise.allSettled([app.deps.prisma.$queryRaw`SELECT 1`, app.deps.redis.ping()]);
    const results = {
      postgres: checks[0].status === "fulfilled" ? "ok" : "down",
      redis: checks[1].status === "fulfilled" ? "ok" : "down",
    };
    const ready = Object.values(results).every((v) => v === "ok");
    reply.status(ready ? 200 : 503);
    return { status: ready ? "ready" : "degraded", checks: results };
  });
}
