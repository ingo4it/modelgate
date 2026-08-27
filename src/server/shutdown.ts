import type { FastifyInstance } from "fastify";
import type { Logger } from "../telemetry/logger.js";

/**
 * Graceful shutdown: stop accepting connections, let in-flight answers (and
 * open SSE streams) finish, then close Postgres and Redis. A hard deadline
 * guarantees the process exits.
 */
export function installShutdown(
  app: FastifyInstance,
  extra: { logger: Logger; onClose: Array<() => Promise<void>>; deadlineMs?: number },
): void {
  let down = false;
  async function shutdown(signal: string): Promise<void> {
    if (down) return;
    down = true;
    extra.logger.info({ signal }, "shutdown: draining");

    const kill = setTimeout(() => {
      extra.logger.error("shutdown: deadline exceeded, forcing exit");
      process.exit(1);
    }, extra.deadlineMs ?? 15_000);
    kill.unref();

    try {
      await app.close();
      for (const fn of extra.onClose) await fn();
      process.exit(0);
    } catch (err) {
      extra.logger.error({ err }, "shutdown: error during close");
      process.exit(1);
    }
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) process.once(sig, () => void shutdown(sig));
  process.on("unhandledRejection", (reason) => extra.logger.error({ reason }, "unhandledRejection"));
}
