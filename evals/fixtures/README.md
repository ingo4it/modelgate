# evals/fixtures

`model.json` maps `sha256(system + " " + user)[:32]` → a recorded model
response, so `pnpm eval --provider fixture` runs offline and deterministically
(this is the CI path).

Record it against the real provider:

```bash
RECORD=1 pnpm eval --provider anthropic
```

which appends every `(prompt → response)` pair it sees. Commit the result. A
prompt change (`PROMPT_VERSION`) or a corpus change invalidates the keys, so
re-record when either moves.

`model.json` ships empty here; with no fixture and `--provider fixture`, the
`FixtureProvider` is constructed with `onMiss: "empty"` and every question
falls back to the abstain answer — the harness still runs end to end, the
scores just aren't meaningful until fixtures exist or you point it at
`--provider anthropic`.
