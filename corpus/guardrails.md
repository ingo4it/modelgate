# Guardrails

## Input

Before anything is embedded or sent to a model, the question is checked: it must
be a non-empty string within the character limit, free of control characters,
and it must not match the prompt-injection heuristics (for example "ignore the
previous instructions" or an attempt to make the service reveal its system
prompt). A rejected question returns a 422.

## Output

The model's answer is checked before it reaches the client. A refusal is
surfaced as a 422, not dressed up as an answer. An empty answer is a 502.
Citation markers that do not correspond to a chunk that was actually in context
are stripped. If a substantive answer carries no valid citations it is flagged
as uncited and is not cached. Any personally identifiable information in the
answer is redacted as defence in depth.

## Abstention

When the retrieved context does not contain the answer, modelgate must abstain.
The instructed behaviour is to reply exactly "I don't have enough context to
answer that." rather than guessing from outside knowledge. The abstain answer
is allowed to be uncited.
