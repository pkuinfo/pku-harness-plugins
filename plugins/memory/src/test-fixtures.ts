import type { Memory } from './rank';

/** Test fixtures shared by the memory tests. */
export const now = new Date(2026, 9, 18).getTime();
export const mem = (id: string, text: string, over: Partial<Memory> = {}): Memory => ({
  id,
  text,
  kind: 'fact',
  pinned: false,
  uses: 0,
  createdAt: now - 86_400_000,
  updatedAt: now - 86_400_000,
  status: 'active',
  source: { kind: 'user_said' },
  ...over,
});
