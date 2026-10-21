/**
 * Memory ordering and relevance without embeddings (none on the phone). The per-chat snapshot
 * uses a fixed order (pinned, kind, age, id) so the same memories always render the same way;
 * `recall` ranks by overlap of CJK character bigrams and Latin/number words with the query,
 * plus small boosts for pinned, recently updated and frequently used memories. Pure, unit-tested.
 */

export type MemoryKind = 'preference' | 'fact' | 'routine' | 'person' | 'other';
export const KINDS: readonly MemoryKind[] = ['preference', 'fact', 'routine', 'person', 'other'];

/** Who a memory came from: the user's own words in chat, the memory screen, or the AI's guess. */
export type SourceKind = 'user_said' | 'ui' | 'inferred';

export type Memory = {
  id: string;
  text: string;
  kind: MemoryKind;
  pinned: boolean;
  uses: number;
  createdAt: number;
  updatedAt: number;
  /** 'pending' memories wait for the user's approval and are never shown to the model. */
  status: 'active' | 'pending';
  source: { kind: SourceKind; sessionId?: string };
  /** A pending memory that, once approved, updates this one instead of adding a new one. */
  replaces?: string;
};

/** A memory as tools return it (index.ts `view`). */
export type MemoryView = Pick<Memory, 'id' | 'text' | 'kind' | 'pinned' | 'status' | 'createdAt' | 'updatedAt' | 'replaces'> & { source: SourceKind };

type Ordered = Pick<Memory, 'id' | 'kind' | 'pinned' | 'createdAt'>;

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

/** Snapshot order: pinned first, then by kind (KINDS order), then oldest first, then id. */
export function bySnapshotOrder(a: Ordered, b: Ordered): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  const k = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  if (k) return k;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The once-per-chat snapshot: active memories in snapshot order, cut where the count or the
 * character budget runs out (a prefix of the order, so it never depends on the query).
 */
export function selectSnapshot(memories: Memory[], limit = 30, maxChars = 1500): Memory[] {
  const out: Memory[] = [];
  let chars = 0;
  for (const m of memories.filter((x) => x.status === 'active').sort(bySnapshotOrder)) {
    if (out.length >= limit || chars + m.text.length > maxChars) break;
    out.push(m);
    chars += m.text.length;
  }
  return out;
}

/** Active memories most related to a query (the long tail the snapshot leaves out). */
export function rankForQuery(memories: Memory[], query: string, now: number, limit = 8, minScore = 0.1): Memory[] {
  return memories
    .filter((m) => m.status === 'active')
    .map((m) => ({ m, s: score(m, query, now) }))
    .filter((x) => x.s > minScore)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}

/** Existing memories that say nearly the same thing, most similar first. */
export function findSimilar(memories: Memory[], text: string, threshold = 0.5, limit = 3): Memory[] {
  return memories
    .map((m) => ({ m, s: similarity(m.text, text) }))
    .filter((x) => x.s >= threshold)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}
