# Model pricing and context windows

These are the first-party Anthropic API list prices modelgate uses for cost
attribution. They are per one million tokens.

## Claude Opus 5

Opus 5 costs $5.00 per million input tokens and $25.00 per million output
tokens. Its context window is 1M tokens.

## Claude Sonnet 5

Sonnet 5 is modelgate's default primary model. It costs $2.00 per million input
tokens and $10.00 per million output tokens. Its context window is 1M tokens.

## Claude Haiku 4.5

Haiku 4.5 is modelgate's default fallback model. It costs $1.00 per million
input tokens and $5.00 per million output tokens. Its context window is 200K
tokens, smaller than the Opus and Sonnet families.

## Embeddings

Embeddings are not an Anthropic product. modelgate uses Voyage AI `voyage-3` at
roughly $0.06 per million input tokens. The embedding output is the vector, not
billed as tokens.
