import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The unit suite covers pure logic (guardrails, cache keys, fallback
    // policy, cost math); the route/retrieval/model layer needs the
    // Testcontainers-backed suite to exercise meaningfully. No global
    // threshold is enforced for that reason — coverage is still reported.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/server/app.ts", "src/**/*.d.ts"],
    },
  },
});
