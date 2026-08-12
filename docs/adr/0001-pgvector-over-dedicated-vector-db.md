# ADR-0001 — pgvector over a dedicated vector database

- Status: Accepted
- Date: 2026-08-12

## Context

RAG needs an approximate-nearest-neighbour index over chunk embeddings. Options:

1. **pgvector** — a Postgres extension; vectors live in the same database as
   everything else, HNSW index for ANN.
2. **A dedicated vector DB** (Pinecone, Qdrant, Weaviate, Milvos) — purpose-built
   ANN, richer filtering, horizontal scale.

## Decision

Use **pgvector** in the existing Postgres instance. Similarity search is one raw
SQL query (`embedding <=> $1`); everything else goes through Prisma.

## Rationale

- **One datastore.** modelgate already runs Postgres for documents, the
  semantic cache, and usage events. Adding pgvector is an extension, not a new
  system to deploy, back up, secure, and monitor.
- **Transactional ingest.** "Replace all chunks for this document" is a single
  Postgres transaction. With a separate vector store, ingest is a distributed
  write with its own failure modes.
- **Scale headroom is sufficient.** HNSW on pgvector handles millions of vectors
  with sub-100ms recall. This service targets a curated corpus, not web-scale.
- **Metadata filtering is a plain `WHERE`.** Corpus tags, document status, and
  future per-tenant scoping are just SQL joins.

## Consequences

- The `embedding` column is `Unsupported("vector(1024)")` in the Prisma schema —
  Prisma can't express the operator, so the ANN query and the embedding write
  are hand-written SQL. That code is isolated in `retrieval/store.ts`.
- The embedding dimension (1024) is baked into the migration. Changing the
  embedding model to one with a different dimension is a migration plus a full
  re-ingest, not a config flip.
- If the corpus or QPS grows past what one Postgres box serves comfortably, the
  `VectorSearch` interface is the seam to swap in a dedicated store behind —
  the pipeline doesn't know the difference.
