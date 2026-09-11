import { loadConfig } from "./server/config.js";
import { buildApp } from "./server/app.js";
import { createDeps, closeDeps } from "./server/deps.js";
import { installShutdown } from "./server/shutdown.js";

const config = loadConfig();
const deps = createDeps(config);
const app = await buildApp(deps);

// periodic housekeeping: drop expired semantic-cache rows
const sweep = setInterval(() => {
  void deps.semanticCache.sweep().then((n) => {
    if (n > 0) deps.logger.debug({ removed: n }, "semantic cache sweep");
  });
}, 5 * 60_000);
sweep.unref();

installShutdown(app, {
  logger: deps.logger,
  onClose: [async () => clearInterval(sweep), () => closeDeps(deps)],
});

await app.listen({ host: "0.0.0.0", port: config.port });
deps.logger.info({ port: config.port }, "modelgate listening");
