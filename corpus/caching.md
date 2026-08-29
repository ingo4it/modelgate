# Caching

modelgate has two response caches, checked before any retrieval or model call.

## Exact cache

An exact-match cache in Redis, keyed by the normalised question plus the model
id plus the corpus version. Normalisation lowercases, collapses whitespace, and
strips trailing punctuation, so "What is the price?" and "what is the price"
hit the same entry. Entries expire by TTL (default 24 hours) and are all
invalidated at once by bumping the corpus version.

## Semantic cache

A near-duplicate question reuses a stored answer. The stored question
embeddings live in a pgvector table; a lookup takes the nearest neighbour and
accepts it only if cosine similarity is at least 0.97. The threshold is
deliberately high because a wrong semantic cache hit returns a confidently
worded answer to a different question, which is worse than a cache miss. Entries
carry the corpus version and a TTL; a re-ingest bumps the version and orphans
the old rows, which a periodic sweep deletes.

Answers are not cached when the output guardrail flagged them as uncited, or
when a model fallback occurred.
