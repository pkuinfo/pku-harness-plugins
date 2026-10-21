import type { Actor } from '@pku-harness/sdk';

import { admission, checkText, dropRetractionsOf, factLine, logChanges, MAX_ITEMS, MAX_PENDING, SOFT_LIMIT, type Change, type Rejection } from './policy';
import { findSimilar, rankForQuery, type Memory, type MemoryKind } from './rank';

/**
 * Memory operations as pure state transitions (index.ts loads and saves the state). Every
 * write goes through the taint gate (`admission`); changes to memories the model may have seen
 * are logged so the next turn can retract them (policy.ts `contextBlock`).
 */

export type State = { items: Memory[]; changes: Change[] };
export type Who = { actor: Actor; tainted?: boolean; userAsked?: boolean; sessionId?: string; autoRemember: boolean };
export type TextInput = { text: string; kind?: MemoryKind; pinned?: boolean; userSaid?: boolean };

export type WriteResult =
  | { status: 'saved'; memory: Memory; nearLimit?: boolean }
  | { status: 'pending'; memory: Memory }
  | { status: 'exists'; memory: Memory }
  | { status: 'similar'; candidates: Memory[] }
  | { status: 'full' }
  | { status: 'pendingFull' }
  | { status: 'notFound' }
  | { status: 'rejected'; reason: Rejection };

type Out = { state: State; result: WriteResult };

const same = (a: string, b: string) => factLine(a).toLowerCase() === factLine(b).toLowerCase();

/** Save a new memory, or update `replaces` (an id; 'new' = keep both despite a similar one). */
export function remember(state: State, input: TextInput & { replaces?: string }, who: Who, now: number, newId: () => string): Out {
  const checked = checkText(input.text);
  if (!checked.ok) return { state, result: { status: 'rejected', reason: checked.reason } };
  const text = checked.text;
  if (input.replaces && input.replaces !== 'new') {
    const target = state.items.find((m) => m.id === input.replaces);
    if (!target) return { state, result: { status: 'notFound' } };
    return writeText(state, target, { ...input, text }, who, now, newId);
  }
  const dup = state.items.find((m) => same(m.text, text));
  if (dup) return { state, result: { status: 'exists', memory: dup } };
  // The model chooses between updating and adding; nothing is merged silently.
  if (input.replaces !== 'new' && who.actor !== 'user') {
    const candidates = findSimilar(state.items, text);
    if (candidates.length) return { state, result: { status: 'similar', candidates } };
  }
  // At the cap the model is asked to consolidate; nothing is evicted silently.
  if (state.items.length >= MAX_ITEMS) return { state, result: { status: 'full' } };
  const adm = admission({ ...who, userSaid: input.userSaid });
  if (adm.status === 'pending' && state.items.filter((m) => m.status === 'pending').length >= MAX_PENDING) return { state, result: { status: 'pendingFull' } };
  const memory: Memory = {
    id: newId(),
    text,
    kind: input.kind ?? 'fact',
    pinned: input.pinned ?? false,
    uses: 0,
    createdAt: now,
    updatedAt: now,
    status: adm.status,
    source: { kind: adm.source, ...(who.sessionId ? { sessionId: who.sessionId } : null) },
  };
  const items = [...state.items, memory];
  if (adm.status === 'pending') return { state: { ...state, items }, result: { status: 'pending', memory } };
  return {
    state: { items, changes: dropRetractionsOf(state.changes, text) },
    result: { status: 'saved', memory, ...(items.length > SOFT_LIMIT ? { nearLimit: true } : null) },
  };
}

/**
 * New text for an existing memory. A trusted write edits it in place (logging a correction the
 * model may have seen); an untrusted one becomes a pending replacement the user approves.
 */
function writeText(state: State, target: Memory, input: TextInput, who: Who, now: number, newId: () => string): Out {
  const adm = admission({ ...who, userSaid: input.userSaid });
  const source = { kind: adm.source, ...(who.sessionId ? { sessionId: who.sessionId } : null) };
  if (adm.status === 'active' || target.status === 'pending') {
    const memory: Memory = { ...target, text: input.text, kind: input.kind ?? target.kind, pinned: input.pinned ?? target.pinned, updatedAt: now, source };
    let changes = state.changes;
    if (target.status === 'active' && !same(target.text, input.text)) {
      changes = logChanges(dropRetractionsOf(changes, input.text), [{ at: now, kind: 'updated', old: target.text, text: input.text }], now);
    }
    return { state: { items: state.items.map((m) => (m.id === target.id ? memory : m)), changes }, result: { status: 'saved', memory } };
  }
  // One pending replacement per memory: a newer proposal replaces the older one.
  const rest = state.items.filter((m) => !(m.status === 'pending' && m.replaces === target.id));
  if (rest.filter((m) => m.status === 'pending').length >= MAX_PENDING) return { state, result: { status: 'pendingFull' } };
  const memory: Memory = {
    id: newId(),
    text: input.text,
    kind: input.kind ?? target.kind,
    pinned: input.pinned ?? target.pinned,
    uses: 0,
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    source,
    replaces: target.id,
  };
  return { state: { ...state, items: [...rest, memory] }, result: { status: 'pending', memory } };
}

/** Change a memory's text (gated like `remember`), kind or pin. */
export function update(state: State, input: { id: string; text?: string; kind?: MemoryKind; pinned?: boolean }, who: Who, now: number, newId: () => string): Out {
  const target = state.items.find((m) => m.id === input.id);
  if (!target) return { state, result: { status: 'notFound' } };
  if (input.text != null && !same(input.text, target.text)) {
    const checked = checkText(input.text);
    if (!checked.ok) return { state, result: { status: 'rejected', reason: checked.reason } };
    return writeText(state, target, { text: checked.text, kind: input.kind, pinned: input.pinned }, who, now, newId);
  }
  const memory: Memory = { ...target, kind: input.kind ?? target.kind, pinned: input.pinned ?? target.pinned, updatedAt: now };
  return { state: { ...state, items: state.items.map((m) => (m.id === target.id ? memory : m)) }, result: { status: 'saved', memory } };
}

/** Delete by id, or every active memory matching a query; pending replacements of them go too. */
export function forget(state: State, input: { id?: string; query?: string }, now: number): { state: State; removed: Memory[] } {
  const hit = input.id
    ? state.items.filter((m) => m.id === input.id)
    : input.query
      ? rankForQuery(state.items, input.query, now, MAX_ITEMS, 0.3)
      : [];
  if (!hit.length) return { state, removed: [] };
  const ids = new Set(hit.map((m) => m.id));
  const removed = state.items.filter((m) => ids.has(m.id) || (m.replaces != null && ids.has(m.replaces)));
  const deleted: Change[] = removed.filter((m) => m.status === 'active').map((m) => ({ at: now, kind: 'deleted', old: m.text }));
  return { state: { items: state.items.filter((m) => !removed.includes(m)), changes: logChanges(state.changes, deleted, now) }, removed };
}

/** The user approves or rejects a pending memory. */
export function review(state: State, id: string, approve: boolean, now: number): Out {
  const p = state.items.find((m) => m.id === id && m.status === 'pending');
  if (!p) return { state, result: { status: 'notFound' } };
  const rest = state.items.filter((m) => m.id !== id);
  if (!approve) return { state: { ...state, items: rest }, result: { status: 'saved', memory: p } };
  const target = p.replaces ? rest.find((m) => m.id === p.replaces) : undefined;
  if (target) {
    const memory: Memory = { ...target, text: p.text, kind: p.kind, pinned: p.pinned, updatedAt: now, source: p.source };
    let changes = dropRetractionsOf(state.changes, p.text);
    if (target.status === 'active' && !same(target.text, p.text)) changes = logChanges(changes, [{ at: now, kind: 'updated', old: target.text, text: p.text }], now);
    return { state: { items: rest.map((m) => (m.id === target.id ? memory : m)), changes }, result: { status: 'saved', memory } };
  }
  const memory: Memory = { ...p, status: 'active', replaces: undefined, updatedAt: now };
  return { state: { items: [...rest, memory], changes: dropRetractionsOf(state.changes, p.text) }, result: { status: 'saved', memory } };
}

/** Delete everything (the user, from the memory screen); chats that saw memories get retractions. */
export function clearAll(state: State, now: number): State {
  const deleted: Change[] = state.items.filter((m) => m.status === 'active').map((m) => ({ at: now, kind: 'deleted', old: m.text }));
  return { items: [], changes: logChanges(state.changes, deleted, now) };
}
