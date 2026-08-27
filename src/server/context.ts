import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { Logger } from "../telemetry/logger.js";
import type { Config } from "./config.js";
import type { AnswerService } from "../answer/answer.service.js";
import type { UsageRecorder } from "../usage/events.js";
import type { SemanticCache } from "../cache/semantic.js";

export type Deps = {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
  answers: AnswerService;
  usage: UsageRecorder;
  semanticCache: SemanticCache;
};

declare module "fastify" {
  interface FastifyInstance {
    deps: Deps;
  }
  interface FastifyRequest {
    reqId: string;
  }
}
