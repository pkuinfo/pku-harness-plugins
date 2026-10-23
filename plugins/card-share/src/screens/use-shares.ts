import type { PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useMemo, useReducer, useState } from 'react';

import { MOCK_KEY, shareManager, type ShareManager } from '../manager';
import { ongoingText } from '../strings';

/** The plugin's share manager for a screen, re-rendering on every share change. */
export function useShares({ host, services, kv, cloud }: Pick<PluginScreenProps, 'host' | 'services' | 'kv' | 'cloud'>): {
  manager: ShareManager | null;
  mock: boolean;
  setMock(v: boolean): Promise<void>;
} {
  const locale = host.useLocale();
  const [mock, setMockState] = useState<boolean | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let live = true;
    void kv.get<boolean>(MOCK_KEY).then((v) => live && setMockState(v ?? false));
    return () => {
      live = false;
    };
  }, [kv]);

  const manager = useMemo(() => (mock === null ? null : shareManager({ kv, services, cloud, mock, ongoingText: ongoingText(locale) })), [kv, services, cloud, mock, locale]);

  useEffect(() => {
    if (!manager) return;
    const off = manager.subscribe(bump);
    void manager.load().then(bump);
    return off;
  }, [manager]);

  return {
    manager,
    mock: mock ?? false,
    setMock: async (v) => {
      await kv.set(MOCK_KEY, v);
      setMockState(v);
    },
  };
}

/** "28:12" or "1:05:09". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
