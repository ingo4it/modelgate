import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import type { Deps } from "./context.js";
import { errorHandler } from "./errors-plugin.js";
import { healthRoutes } from "./health.js";
import { answerRoutes } from "../answer/answer.routes.js";

const requestId = fp((app, _o, done) => {
  app.addHook("onRequest", (req, reply, next) => {
    const inbound = req.headers["x-request-id"];
    req.reqId = (Array.isArray(inbound) ? inbound[0] : inbound) || randomUUID();
    reply.header("x-request-id", req.reqId);
    req.log = req.log.child({ reqId: req.reqId });
    next();
  });
  done();
}, { name: "request-id" });

/**
 * Build the HTTP app from injected `Deps`. Pure: no listen, no signals, no
 * connect. `index.ts` owns the process.
 */
export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.logger,
    trustProxy: true,
    requestIdHeader: false,
    bodyLimit: 512 * 1024,
  });

  app.decorate("deps", deps);

  await app.register(requestId);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: false });

  await app.register(healthRoutes);
  await app.register(answerRoutes);
  await app.register(errorHandler);

  await app.ready();
  return app;
}
