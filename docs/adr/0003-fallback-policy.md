# ADR-0003 — Model fallback: downgrade vs. fail fast

- Status: Accepted
- Date: 2026-08-16

## Context

The model provider will sometimes be slow, rate-limited, or down. modelgate has
a latency SLO (p95 ≤ 4s). When the primary model (`claude-sonnet-5`) can't
answer in time, the choices are: wait, fail the request, or downgrade to a
faster/cheaper model (`claude-haiku-4-5`).

## Decision

Downgrade on **retryable** failures, once:

| Primary outcome              | Action                                                  |
| ---------------------------- | ------------------------------------------------------- |
| timeout (`MODEL_TIMEOUT_MS`) | try fallback                                            |
| 429 rate limit               | try fallback                                            |
| 529 / 503 overloaded         | try fallback                                            |
| transport / connection error | try fallback                                            |
| 400 bad request              | **fail** — it's our bug, a different model won't fix it |
| `stop_reason: "refusal"`     | **surface as 422** — not a transport problem            |

For **streaming**, fall back only if the primary fails before the first token.
Once bytes are on the wire the stream can't be cleanly restarted, so a
mid-stream failure ends the SSE stream with an `error` event.

Every downgrade is recorded (`UsageEvent.fellBack`, a log line) so the fallback
rate is a monitored number, not a silent degradation.

## Rationale

- A degraded answer within SLO beats a timeout error. Haiku on the same grounded
  context with the same guardrails is usually a small quality drop, not a wrong
  answer.
- Not retrying `bad_request` avoids masking our own bugs and burning a second
  call on a request that can't succeed.
- The "no fallback mid-stream" rule keeps the client contract simple: a stream
  either completes on one model or errors; it never silently switches voice
  partway through.

## Consequences

- The fallback answer is **not cached** — caching a Haiku answer under a key
  that a healthy Sonnet request would also hit would poison the cache with the
  degraded version.
- A sustained primary outage shows up as a fallback-rate spike on the dashboard;
  that's the alert signal, and the roadmap's per-tenant budgets would throttle
  before the fallback model's own limits are hit.
- Two models means two sets of rate limits and two price points; cost
  attribution already tracks which model answered.
