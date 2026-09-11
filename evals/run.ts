/**
 * Eval harness.  pnpm eval  [--provider fixture|anthropic] [--gate]
 *
 * Runs every case in `dataset/cases.jsonl` through the real `AnswerService`,
 * scores faithfulness / answer-relevance / retrieval-hit-rate@5, prints a
 * table, writes `results/latest.json`, and (with `--gate`) exits non-zero if
 * any aggregate is below its target — that's the CI release gate (ADR-0002).
 *
 *   --provider fixture  : FixtureEmbedder + MemoryVectorStore + FixtureProvider,
 *                         fully offline and deterministic. Used in CI.
 *   --provider anthropic: real Voyage + Anthropic. Records model fixtures when
 *                         RECORD=1 is set.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "../src/server/config.js";
import { createLogger } from "../src/telemetry/logger.js";
import { FixtureEmbedder, VoyageEmbedder, type Embedder } from "../src/retrieval/embeddings.js";
import { IdentityReranker } from "../src/retrieval/rerank.js";
import { RetrievalPipeline } from "../src/retrieval/pipeline.js";
import { FixtureProvider } from "../src/model/fixture.js";
import { AnthropicProvider } from "../src/model/anthropic.js";
import { FallbackProvider } from "../src/model/fallback.js";
import { AnswerService } from "../src/answer/answer.service.js";
import { MemoryVectorStore } from "./support/memory-store.js";
import { hitRateAtK } from "./scorers/hit-rate.js";
import { answerRelevance } from "./scorers/relevance.js";
import { HeuristicJudge, LlmJudge, type FaithfulnessJudge } from "./scorers/faithfulness.js";

const HERE = dirname(fileURLToPath(import.meta.url));

type Case = {
  id: string;
  question: string;
  reference: string;
  mustContain: string[];
  expectedSources: string[];
};

const TARGETS = {
  faithfulness: 0.9,
  answerRelevance: 0.85,
  hitRateAt5: 0.8,
  p95LatencyMs: 4000,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const providerKind = valueOf(args, "--provider") ?? "fixture";
  const gate = args.includes("--gate");

  const config = loadConfig();
  const logger = createLogger({ ...config, logLevel: "warn" });

  const cases = (await readFile(join(HERE, "dataset/cases.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Case);

  // --- assemble an AnswerService for the chosen provider ---
  const embedder: Embedder =
    providerKind === "anthropic"
      ? new VoyageEmbedder(config.embedding.apiKey, config.embedding.model, config.embedding.dim)
      : new FixtureEmbedder(config.embedding.model, config.embedding.dim);

  const store = new MemoryVectorStore();
  await store.loadCorpus(join(HERE, "../corpus"), embedder, {
    targetTokens: config.retrieval.chunkTokens,
    overlapTokens: config.retrieval.chunkOverlap,
  });

  const retrieval = new RetrievalPipeline(store, new IdentityReranker(), {
    topK: config.retrieval.topK,
    rerankTopN: config.retrieval.rerankTopN,
    contextMaxTokens: 6000,
  });

  const inner =
    providerKind === "anthropic"
      ? new AnthropicProvider(config.model.apiKey, config.model.timeoutMs)
      : await FixtureProvider.fromFile(join(HERE, "fixtures/model.json"), "empty");
  const model = new FallbackProvider(inner, config.model.primary, config.model.fallback, logger);

  const judge: FaithfulnessJudge =
    providerKind === "anthropic" ? new LlmJudge(config.model.apiKey) : new HeuristicJudge();

  const answers = new AnswerService({
    config,
    logger,
    embedder,
    retrieval,
    model,
    exactCache: noopExactCache(),
    semanticCache: noopSemanticCache(),
    usage: { record: async () => {} },
  });

  // --- run cases ---
  const rows: ScoredCase[] = [];
  for (const c of cases) {
    const started = performance.now();
    let answer = "";
    let error: string | undefined;
    try {
      const res = await answers.answer(c.question, `eval:${c.id}`, undefined);
      answer = res.answer;
    } catch (err) {
      // no-context is a valid outcome for the out-of-corpus case
      answer = "I don't have enough context to answer that.";
      error = (err as Error).message;
    }
    const latencyMs = Math.round(performance.now() - started);

    const retrieved = await retrieval.retrieve(
      c.question,
      (await embedder.embed([{ text: c.question, kind: "query" }])).vectors[0] ?? [],
    );
    const hit = hitRateAtK(retrieved.context.used, c.expectedSources, 5);
    const relevance = await answerRelevance(embedder, answer, c.reference, c.mustContain);
    const faith = await judge.score({ answer, context: retrieved.context.text });

    rows.push({
      id: c.id,
      latencyMs,
      faithfulness: faith.score,
      answerRelevance: relevance,
      hitRateAt5: hit,
      error,
    });
  }

  const agg = aggregate(rows);
  print(rows, agg);

  const out = {
    generatedAt: new Date().toISOString(),
    provider: providerKind,
    judge: judge.name,
    cases: rows.length,
    targets: TARGETS,
    aggregate: agg,
    perCase: rows,
  };
  await mkdir(join(HERE, "results"), { recursive: true });
  await writeFile(join(HERE, "results/latest.json"), JSON.stringify(out, null, 2) + "\n");

  if (gate) {
    const failures = [
      agg.faithfulness < TARGETS.faithfulness && "faithfulness",
      agg.answerRelevance < TARGETS.answerRelevance && "answerRelevance",
      agg.hitRateAt5 < TARGETS.hitRateAt5 && "hitRateAt5",
      agg.p95LatencyMs > TARGETS.p95LatencyMs && "p95LatencyMs",
    ].filter(Boolean);
    if (failures.length > 0) {
      console.error(`\nEVAL GATE FAILED: ${failures.join(", ")}`);
      process.exit(1);
    }
    console.error("\nEVAL GATE PASSED");
  }
}

type ScoredCase = {
  id: string;
  latencyMs: number;
  faithfulness: number;
  answerRelevance: number;
  hitRateAt5: number;
  error?: string;
};

function aggregate(rows: ScoredCase[]) {
  const mean = (f: (r: ScoredCase) => number) => rows.reduce((s, r) => s + f(r), 0) / (rows.length || 1);
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    faithfulness: round(mean((r) => r.faithfulness)),
    answerRelevance: round(mean((r) => r.answerRelevance)),
    hitRateAt5: round(mean((r) => r.hitRateAt5)),
    p95LatencyMs: latencies[Math.min(latencies.length - 1, Math.floor(0.95 * latencies.length))] ?? 0,
  };
}

function print(rows: ScoredCase[], agg: ReturnType<typeof aggregate>): void {
  console.log("\n case                    faith  relev  hit@5  ms");
  for (const r of rows) {
    console.log(
      ` ${r.id.padEnd(22)} ${fmt(r.faithfulness)}  ${fmt(r.answerRelevance)}  ${fmt(r.hitRateAt5)}  ${String(r.latencyMs).padStart(5)}`,
    );
  }
  console.log(
    `\n aggregate               ${fmt(agg.faithfulness)}  ${fmt(agg.answerRelevance)}  ${fmt(agg.hitRateAt5)}  p95=${agg.p95LatencyMs}`,
  );
  console.log(
    ` targets                 ${fmt(TARGETS.faithfulness)}  ${fmt(TARGETS.answerRelevance)}  ${fmt(TARGETS.hitRateAt5)}  <=${TARGETS.p95LatencyMs}\n`,
  );
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const fmt = (n: number) => n.toFixed(2);
const valueOf = (args: string[], flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function noopExactCache() {
  return { get: async () => null, set: async () => {} };
}
function noopSemanticCache() {
  return { lookup: async () => null, store: async () => {} };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
