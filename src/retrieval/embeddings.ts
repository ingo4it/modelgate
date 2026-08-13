import { VoyageAIClient } from "voyageai";

/**
 * Anthropic has no embeddings endpoint, so embeddings come from Voyage AI (the
 * provider Anthropic recommends). Everything downstream depends on this
 * interface, not on Voyage — the eval and unit suites swap in `FixtureEmbedder`
 * for deterministic, offline runs.
 */
export type EmbedInput = { text: string; kind: "document" | "query" };

export type EmbedResult = {
  vectors: number[][];
  tokens: number;
};

export interface Embedder {
  readonly model: string;
  readonly dim: number;
  embed(inputs: EmbedInput[]): Promise<EmbedResult>;
}

export class VoyageEmbedder implements Embedder {
  private readonly client: VoyageAIClient;

  constructor(
    apiKey: string,
    readonly model: string,
    readonly dim: number,
  ) {
    this.client = new VoyageAIClient({ apiKey });
  }

  async embed(inputs: EmbedInput[]): Promise<EmbedResult> {
    if (inputs.length === 0) return { vectors: [], tokens: 0 };

    // Voyage wants a single input_type per call; documents and queries use
    // different projections, so callers must not mix kinds in one batch.
    const kind = inputs[0]!.kind;
    if (inputs.some((i) => i.kind !== kind)) {
      throw new Error("embed(): all inputs in a batch must share the same kind");
    }

    const res = await this.client.embed({
      model: this.model,
      input: inputs.map((i) => i.text),
      inputType: kind === "query" ? "query" : "document",
      outputDimension: this.dim,
    });

    const vectors = (res.data ?? []).map((d) => d.embedding ?? []);
    return { vectors, tokens: res.usage?.totalTokens ?? 0 };
  }
}

/**
 * Deterministic hash-based pseudo-embedding for tests and CI evals. Same text
 * always yields the same unit vector; unrelated texts are near-orthogonal.
 * Not semantically meaningful — only good enough to exercise the pipeline
 * without a network call or an API key.
 */
export class FixtureEmbedder implements Embedder {
  constructor(
    readonly model = "fixture-embed",
    readonly dim = 1024,
  ) {}

  async embed(inputs: EmbedInput[]): Promise<EmbedResult> {
    const vectors = inputs.map((i) => this.hashVector(i.text));
    const tokens = inputs.reduce((n, i) => n + Math.ceil(i.text.length / 4), 0);
    return { vectors, tokens };
  }

  private hashVector(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const token of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h = Math.imul(h ^ token.charCodeAt(i), 16777619);
      }
      const idx = Math.abs(h) % this.dim;
      v[idx]! += 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}
