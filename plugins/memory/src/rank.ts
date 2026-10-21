/**
 * Memory relevance without embeddings (none on the phone): overlap of CJK character bigrams and
 * Latin/number words between the query and each memory, plus small boosts for pinned, recently
 * updated and frequently used memories. Pure, unit-tested.
 */

export type MemoryKind = 'preference' | 'fact' | 'routine' | 'person' | 'other';

export type Memory = {
  id: string;
  text: string;
  kind: MemoryKind;
  pinned: boolean;
  uses: number;
  createdAt: number;
  updatedAt: number;
};

/** Tokens: CJK bigrams (and single chars for 1-char runs) + lowercase words of 2+ chars. */
export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  const s = text.toLowerCase();
  for (const run of s.match(/[㐀-鿿]+/g) ?? []) {
    if (run.length === 1) out.add(run);
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
  }
  for (const w of s.match(/[a-z0-9]{2,}/g) ?? []) out.add(w);
  return out;
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** Score of a memory for a query; > 0 means related. */
export function score(m: Memory, query: string, now: number): number {
  const q = tokens(query);
  const t = tokens(m.text);
  let hit = 0;
  for (const x of q) if (t.has(x)) hit++;
  const overlap = q.size ? hit / Math.sqrt(q.size * Math.max(1, t.size)) : 0;
  const ageDays = (now - m.updatedAt) / 86_400_000;
  const recency = Math.exp(-ageDays / 60) * 0.08;
  const usage = Math.min(m.uses, 20) * 0.004;
  return overlap + recency + usage + (m.pinned ? 0.25 : 0);
}

/**
 * Memories to show the model for a query: pinned ones always, then the most related above
 * `minScore`, capped by count and characters so context stays cheap.
 */
export function selectForContext(memories: Memory[], query: string, now: number, limit = 8, maxChars = 900, minScore = 0.12): Memory[] {
  const ranked = memories
    .map((m) => ({ m, s: score(m, query, now) }))
    .filter((x) => x.m.pinned || x.s > minScore)
    .sort((a, b) => b.s - a.s);
  const out: Memory[] = [];
  let chars = 0;
  for (const { m } of ranked) {
    if (out.length >= limit || chars + m.text.length > maxChars) break;
    out.push(m);
    chars += m.text.length;
  }
  return out;
}

/** An existing memory that says nearly the same thing (to update instead of duplicating). */
export function findDuplicate(memories: Memory[], text: string, threshold = 0.6): Memory | undefined {
  let best: Memory | undefined;
  let bestSim = threshold;
  for (const m of memories) {
    const s = similarity(m.text, text);
    if (s >= bestSim) {
      best = m;
      bestSim = s;
    }
  }
  return best;
}
