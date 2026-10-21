import type { PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Share } from 'react-native';

import { onMemoryChanged } from './events';
import { bySnapshotOrder, KINDS, type MemoryView as Item } from './rank';
import { strings } from './strings';

const SOURCE_TONE = { user_said: 'info', ui: 'neutral', inferred: 'warn' } as const;

/**
 * AI 记忆: approve or discard pending memories, then every memory grouped by kind with where it
 * came from; tap to edit, pin, add, export, clear all, and the 自动记住 switch.
 */
export function MemoryScreen({ host, invoke }: PluginScreenProps) {
  const { Screen, Text, ListGroup, ListRow, IconButton, Chip, EmptyState, Skeleton, FadeIn, Row, Column, Switch } = host.components;
  const s = strings[host.useLocale()];
  const [items, setItems] = useState<Item[] | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    invoke('memory.list')
      .then((r) => {
        setItems(r as Item[]);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    invoke('memory.settings')
      .then((r) => setAuto((r as { autoRemember: boolean }).autoRemember))
      .catch(() => setAuto(true));
  }, [invoke]);
  useEffect(() => {
    const t = setTimeout(load, 0);
    const off = onMemoryChanged(load);
    return () => {
      clearTimeout(t);
      off();
    };
  }, [load]);

  const pending = useMemo(() => (items ?? []).filter((m) => m.status === 'pending').sort((a, b) => a.createdAt - b.createdAt), [items]);
  const groups = useMemo(() => {
    const active = (items ?? []).filter((m) => m.status === 'active').sort(bySnapshotOrder);
    return KINDS.map((k) => ({ kind: k, list: active.filter((m) => m.kind === k) })).filter((g) => g.list.length);
  }, [items]);
  const byId = useMemo(() => new Map((items ?? []).map((m) => [m.id, m])), [items]);
  const activeCount = groups.reduce((n, g) => n + g.list.length, 0);

  const run = async (tool: string, input: Record<string, unknown>) => {
    try {
      await invoke(tool, input);
    } finally {
      load();
    }
  };
  const decide = (m: Item, approve: boolean) => {
    if (approve) host.haptics.success();
    else host.haptics.warning();
    setItems((cur) => cur?.filter((x) => x.id !== m.id || approve).map((x) => (x.id === m.id ? { ...x, status: 'active' as const } : x)) ?? null);
    void run('memory.review', { id: m.id, approve });
  };
  const pin = (m: Item) => {
    host.haptics.select();
    setItems((cur) => cur?.map((x) => (x.id === m.id ? { ...x, pinned: !m.pinned } : x)) ?? null);
    void run('memory.update', { id: m.id, pinned: !m.pinned });
  };
  const toggleAuto = (v: boolean) => {
    host.haptics.select();
    setAuto(v);
    invoke('memory.settings', { autoRemember: v }).catch(() => setAuto(!v));
  };
  const edit = (id?: string) => host.navigate(id ? `/m/memory/edit?id=${encodeURIComponent(id)}` : '/m/memory/edit');

  const exportAs = async (format: 'text' | 'json') => {
    const list = items ?? [];
    const message =
      format === 'json'
        ? JSON.stringify({ exportedAt: new Date().toISOString(), memories: list }, null, 2)
        : [
            s.exportHeader(list.length),
            ...KINDS.flatMap((k) => {
              const of = list.filter((m) => m.kind === k);
              return of.length ? ['', s.kinds[k], ...of.map((m) => `- ${s.exportLine(m.text, s.sources[m.source] ?? m.source, m.status === 'pending')}`)] : [];
            }),
          ].join('\n');
    await Share.share({ title: s.exportTitle, message }, { dialogTitle: s.exportTitle, subject: s.exportTitle }).catch(() => undefined);
  };
  const askExport = () =>
    Alert.alert(s.exportTitle, s.exportHint, [
      { text: s.cancel, style: 'cancel' },
      { text: s.exportText, onPress: () => void exportAs('text') },
      { text: s.exportJson, onPress: () => void exportAs('json') },
    ]);
  const askClear = () =>
    Alert.alert(s.clearTitle, s.clearBody(items?.length ?? 0), [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.confirmClear,
        style: 'destructive',
        onPress: () => {
          host.haptics.warning();
          setItems([]);
          void run('memory.clear', {});
        },
      },
    ]);

  const sourceChip = (m: Item) => <Chip label={s.sources[m.source] ?? m.source} tone={SOURCE_TONE[m.source] ?? 'neutral'} />;

  return (
    <Screen title={s.title} subtitle={s.subtitle || undefined} back trailing={<IconButton icon="plus" label={s.add} variant="ghost" onPress={() => edit()} />}>
      <FadeIn index={0}>
        <Text variant="callout" tone="muted">
          {s.intro}
        </Text>
      </FadeIn>
      <FadeIn index={1}>
        <ListGroup footer={auto === false ? s.autoOff : s.autoOn}>
          <ListRow icon="sparkles" title={s.auto} accessory={<Switch value={auto ?? true} onValueChange={toggleAuto} disabled={auto == null} label={s.auto} />} />
        </ListGroup>
      </FadeIn>
      {error ? (
        <EmptyState icon="warning" title={s.loadFailed} message={error} />
      ) : items == null ? (
        <Column gap="sm">
          <Skeleton height={52} />
          <Skeleton height={52} />
        </Column>
      ) : (
        <>
          {pending.length ? (
            <FadeIn index={2}>
              <ListGroup title={s.pendingTitle(pending.length)} footer={s.pendingFooter}>
                {pending.map((m) => {
                  const old = m.replaces ? byId.get(m.replaces) : undefined;
                  return (
                    <ListRow
                      key={m.id}
                      title={m.text}
                      titleLines={4}
                      subtitle={old ? s.replacesOld(old.text) : `${s.kinds[m.kind] ?? m.kind} · ${s.sources[m.source] ?? m.source}`}
                      onPress={() => edit(m.id)}
                      accessory={
                        <Row gap="xs" align="center">
                          <IconButton icon="close" label={s.reject} variant="ghost" size={36} onPress={() => decide(m, false)} />
                          <IconButton icon="check" label={s.approve} variant="primary" size={36} onPress={() => decide(m, true)} />
                        </Row>
                      }
                    />
                  );
                })}
              </ListGroup>
            </FadeIn>
          ) : null}
          {activeCount === 0 && !pending.length ? (
            <EmptyState icon="sparkles" title={s.empty} message={s.emptyHint} />
          ) : (
            groups.map((g, i) => (
              <FadeIn key={g.kind} index={3 + i}>
                <ListGroup title={s.group(s.kinds[g.kind] ?? g.kind, g.list.length)}>
                  {g.list.map((m) => (
                    <ListRow
                      key={m.id}
                      title={m.text}
                      titleLines={4}
                      subtitle={m.pinned ? s.pinned : undefined}
                      onPress={() => edit(m.id)}
                      accessory={
                        <Row gap="xs" align="center">
                          {sourceChip(m)}
                          <IconButton icon="pin" label={m.pinned ? s.unpin : s.pin} variant={m.pinned ? 'secondary' : 'ghost'} size={36} onPress={() => pin(m)} />
                        </Row>
                      }
                    />
                  ))}
                </ListGroup>
              </FadeIn>
            ))
          )}
          <FadeIn index={3 + groups.length}>
            <ListGroup title={s.manage}>
              <ListRow icon="plus" title={s.add} onPress={() => edit()} chevron />
              {items.length ? <ListRow icon="share" title={s.export} subtitle={s.exportHint} onPress={askExport} chevron /> : null}
              {items.length ? <ListRow icon="trash" title={s.clear} onPress={askClear} /> : null}
            </ListGroup>
          </FadeIn>
        </>
      )}
    </Screen>
  );
}
