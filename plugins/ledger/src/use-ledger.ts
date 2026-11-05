import type { KV } from '@pku-harness/sdk';
import { useEffect, useState, useSyncExternalStore } from 'react';

import type { Entry, Settings } from './model';
import { changes, loadRange, loadSettings } from './store';

export type LedgerData = { entries: Entry[]; settings: Settings };

/**
 * Entries of [start, end)'s months plus settings, re-read whenever anyone writes (a screen, a
 * widget or the agent: every write goes through store.ts and bumps its version). Keeps showing
 * the previous data while the next range loads, so switching months never flashes empty.
 */
export function useLedger(kv: KV, start: number, end: number): LedgerData | null {
  const version = useSyncExternalStore(changes.subscribe, changes.version);
  const [data, setData] = useState<LedgerData | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([loadRange(kv, start, end), loadSettings(kv)]).then(([entries, settings]) => {
      if (live) setData({ entries, settings });
    });
    return () => {
      live = false;
    };
  }, [kv, start, end, version]);
  return data;
}

/** Just the settings (categories, budgets), live like useLedger. */
export function useSettings(kv: KV): Settings | null {
  const version = useSyncExternalStore(changes.subscribe, changes.version);
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    let live = true;
    void loadSettings(kv).then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, [kv, version]);
  return settings;
}
