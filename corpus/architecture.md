# modelgate architecture

modelgate answers questions from a fixed corpus. The request path is: input
guardrails, exact cache, embed the question once, semantic cache, retrieval,
model call with fallback, output guardrails, usage event.

## Retrieval and pgvector

Chunks are stored in PostgreSQL with a `pgvector` column and an HNSW index for
approximate nearest-neighbour search. modelgate uses pgvector rather than a
dedicated vector database because at this corpus size the vectors fit alongside
the rest of the data in one Postgres instance, which removes a second datastore
to operate, back up, and secure. HNSW keeps recall and latency acceptable well
past the sample corpus. A dedicated vector database earns its operational cost
only at a scale this service does not target.

Retrieval is two stages: an approximate vector search for recall over the top 20
chunks, then a cross-encoder rerank for precision, then the top 5 are assembled
into a token-bounded context block with numbered citation markers.

## Model fallback

The primary model is Claude Sonnet 5; the fallback is Claude Haiku 4.5.
modelgate falls back to the secondary model on a retryable provider error: a
timeout, a rate-limit response, an overloaded (529/503) response, or a transport
failure. A malformed-request error is not retried because it is a bug in
modelgate, not a provider problem. For streaming responses the fallback only
happens if the primary fails before the first token is sent; once bytes are on
the wire the stream cannot be cleanly restarted, so a mid-stream failure ends
the stream with an error.

## Streaming and cancellation

Answers can be streamed over Server-Sent Events. A streaming request can be
cancelled mid-stream: closing the HTTP connection aborts the SSE response and
propagates an AbortController signal that cancels the underlying model call, so
a cancelled request stops incurring cost immediately.

## Usage accounting

Every request writes exactly one usage event recording the model used, whether
a fallback happened, the cache outcome, token counts, per-stage latency, and the
estimated dollar cost. The cost and latency dashboard is built from that table.
