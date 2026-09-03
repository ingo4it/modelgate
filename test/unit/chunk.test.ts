import { describe, expect, it } from "vitest";
import { chunkDocument } from "../../src/retrieval/chunk.js";

const para = (n: number) => `Paragraph ${n}. ` + "word ".repeat(40).trim();

describe("chunkDocument", () => {
  it("keeps a short document as a single chunk", () => {
    const chunks = chunkDocument("just one short paragraph here", { targetTokens: 400, overlapTokens: 64 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.ordinal).toBe(0);
  });

  it("splits a long document and numbers chunks sequentially", () => {
    const doc = Array.from({ length: 20 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkDocument(doc, { targetTokens: 200, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  it("carries the boundary paragraph into the next chunk (overlap)", () => {
    const doc = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkDocument(doc, { targetTokens: 220, overlapTokens: 80 });
    const tailOfFirst = chunks[0]!.content.split("\n\n").at(-1)!;
    expect(chunks[1]!.content).toContain(tailOfFirst);
  });

  it("respects the target size (allowing one paragraph of slop)", () => {
    const doc = Array.from({ length: 30 }, (_, i) => para(i)).join("\n\n");
    const target = 300;
    const chunks = chunkDocument(doc, { targetTokens: target, overlapTokens: 0 });
    for (const c of chunks.slice(0, -1)) {
      expect(c.tokenEstimate).toBeLessThanOrEqual(target + Math.ceil(para(0).length / 4));
    }
  });
});
