import type { PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';

import { strings } from './strings';

type Item = { id: string; text: string; kind: string; pinned: boolean };

/** AI 记忆: review, pin and delete memories. Contributed to Settings by this plugin. */
export function MemoryScreen({ host, invoke }: PluginScreenProps) {
  const { Screen, Text, ListGroup, ListRow, IconButton, Chip, EmptyState, Skeleton, FadeIn, Row, Column } = host.components;
  const s = strings[host.useLocale()];
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke('memory.list')
      .then((r) => setItems(r as Item[]))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [invoke]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const forget = async (id: string) => {
    host.haptics.warning();
    setItems((cur) => cur?.filter((m) => m.id !== id) ?? null);
    await invoke('memory.forget', { id }).catch(load);
  };
  const pin = async (m: Item) => {
    host.haptics.select();
    setItems((cur) => cur?.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)) ?? null);
    await invoke('memory.pin', { id: m.id, pinned: !m.pinned }).catch(load);
  };

  return (
    <Screen title={s.title} subtitle={s.subtitle || undefined} back>
      <FadeIn index={0}>
        <Text variant="callout" tone="muted">
          {s.intro}
        </Text>
      </FadeIn>
      {error ? (
        <EmptyState icon="warning" title={s.loadFailed} message={error} />
      ) : items == null ? (
        <Column gap="sm">
          <Skeleton height={52} />
          <Skeleton height={52} />
        </Column>
      ) : items.length === 0 ? (
        <EmptyState icon="sparkles" title={s.empty} message={s.emptyHint} />
      ) : (
        <FadeIn index={1}>
          <ListGroup title={s.count(items.length)}>
            {items.map((m) => (
              <ListRow
                key={m.id}
                title={m.text}
                titleLines={4}
                subtitle={s.kinds[m.kind] ?? m.kind}
                accessory={
                  <Row gap="xs" align="center">
                    {m.pinned ? <Chip label={s.pinned} tone="accent" /> : null}
                    <IconButton icon="bolt" label={m.pinned ? s.unpin : s.pin} variant="ghost" size={36} onPress={() => pin(m)} />
                    <IconButton icon="trash" label={s.remove} variant="ghost" size={36} onPress={() => forget(m.id)} />
                  </Row>
                }
              />
            ))}
          </ListGroup>
        </FadeIn>
      )}
    </Screen>
  );
}
