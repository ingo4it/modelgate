# ADR-0002 — Eval-in-CI as a release gate

- Status: Accepted
- Date: 2026-08-14

## Context

An LLM feature has no compiler for quality. A prompt tweak, a chunking change,
a `topK` bump, or a model swap can each silently degrade answers. Unit tests
don't catch it. Something has to score end-to-end answer quality and block a
regression.

## Decision

A versioned eval suite (`evals/`) is a **required CI check**. It scores every
case in `dataset/cases.jsonl` on faithfulness, answer relevance, and retrieval
hit-rate@5, plus p95 latency, and `--gate` fails the build if any aggregate is
below its target.

The CI path runs **offline and deterministically**: `FixtureEmbedder` +
`MemoryVectorStore` + recorded model responses (`evals/fixtures/model.json`).
No API keys, no spend, no flakiness. The real-provider path
(`--provider anthropic`) is run locally when prompts or the corpus change, and
it re-records the fixtures.

## Rationale

- **Determinism in CI.** A gate that's flaky or costs money per run gets
  disabled. Fixtures make it free and repeatable; the tradeoff is that fixtures
  must be re-recorded on a prompt/corpus change (enforced by `PROMPT_VERSION`
  and the corpus hash invalidating fixture keys).
- **One dataset, reviewed like code.** `cases.jsonl` is line-per-case so diffs
  are readable; case `id`s are stable so historical `results/` stay comparable.
- **Metrics that localise failure.** Hit-rate@5 separates "retrieval missed it"
  from "the model fumbled it"; faithfulness separates "fluent but wrong" from
  "off topic".

## Consequences

- Fixtures are a maintenance cost: a prompt change is a two-step PR (change +
  re-record). Accepted — it's the same discipline as updating a snapshot test.
- The offline judge is a heuristic (citation density + abstain check), not a
  real faithfulness judge. The gate's *offline* faithfulness number is a proxy;
  the authoritative number comes from the `--provider anthropic` run, which uses
  an LLM judge. The report records which judge produced each score.
- Targets (0.90 / 0.85 / 0.80 / 4s) are asserted in `evals/run.ts` and mirrored
  in the README table. Moving a target is a reviewed change.
