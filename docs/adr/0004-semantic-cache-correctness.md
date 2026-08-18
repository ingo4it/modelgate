# ADR-0004 — Semantic cache correctness / staleness tradeoffs

- Status: Accepted
- Date: 2026-08-18

## Context

An exact-match cache only helps for byte-identical questions. A semantic cache —
"is there a stored answer to a question close enough to this one?" — lifts the
hit rate a lot, but introduces two risks: a **wrong hit** (returning a confident
answer to a subtly different question) and **staleness** (returning an answer
built from a corpus that has since changed).

## Decision

- **High similarity threshold.** A stored answer is reused only if the question
  embedding is within cosine ≥ `SEMANTIC_CACHE_MIN_SIMILARITY` (default 0.97).
  The bar is set where near-paraphrases hit and genuinely different questions
  miss. A miss is cheap; a wrong hit is a silent correctness bug.
- **Corpus version in the row.** Every entry carries `corpusVersion`. A
  re-ingest bumps `CORPUS_VERSION`, which makes every prior entry unmatchable in
  one step. A periodic sweep deletes the orphans and TTL-expired rows.
- **TTL as a backstop.** Even within a corpus version, entries expire (default
  1h) so a prompt change or a scoring fix propagates without a manual flush.
- **Don't cache low-confidence answers.** Uncited answers and fallback-model
  answers are never written to either cache.

## Rationale

- The failure mode that matters is a *confidently wrong* cached answer. Every
  knob here trades hit rate for a lower chance of that: high threshold, version
  gating, short TTL.
- Version-in-the-key beats a cache flush: no coordination, no thundering herd on
  invalidation, old rows just age out.

## Consequences

- Hit rate is lower than a naive semantic cache would show. That's the point;
  the dashboard tracks hit rate so the threshold can be tuned against real
  traffic rather than guessed.
- A re-ingest leaves dead rows until the sweep runs — bounded storage waste, not
  a correctness issue.
- The threshold is a single global number. Per-topic thresholds (some domains
  tolerate looser matching) are a roadmap item, not built now.
