/**
 * Token-approximate chunking. Splits on paragraph boundaries first, then packs
 * paragraphs into windows of ~`targetTokens` with `overlapTokens` carried
 * between windows so a fact that straddles a boundary is still retrievable.
 *
 * Token count is estimated as chars/4 — good enough for chunk sizing; the exact
 * count comes back from the embedding provider and is what gets stored.
 */
export type Chunk = {
  ordinal: number;
  content: string;
  tokenEstimate: number;
};

export type ChunkOptions = {
  targetTokens: number;
  overlapTokens: number;
};

const estTokens = (s: string) => Math.ceil(s.length / 4);

export function chunkDocument(text: string, opts: ChunkOptions): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let ordinal = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const content = buf.join("\n\n");
    chunks.push({ ordinal: ordinal++, content, tokenEstimate: estTokens(content) });

    // seed the next buffer with a tail overlap
    const overlap: string[] = [];
    let acc = 0;
    for (let i = buf.length - 1; i >= 0 && acc < opts.overlapTokens; i--) {
      overlap.unshift(buf[i]!);
      acc += estTokens(buf[i]!);
    }
    buf = overlap;
    bufTokens = acc;
  };

  for (const para of paragraphs) {
    const t = estTokens(para);
    if (bufTokens + t > opts.targetTokens && buf.length > 0) flush();
    buf.push(para);
    bufTokens += t;
  }
  flush();

  return chunks;
}
