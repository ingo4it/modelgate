import { pino, type Logger } from "pino";
import type { Config } from "../server/config.js";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers['x-api-key']",
  "*.apiKey",
  "*.ANTHROPIC_API_KEY",
  "*.VOYAGE_API_KEY",
];

export function createLogger(config: Config): Logger {
  return pino({
    level: config.logLevel,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    formatters: { level: (label) => ({ level: label }) },
    base: { service: "modelgate", env: config.nodeEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
