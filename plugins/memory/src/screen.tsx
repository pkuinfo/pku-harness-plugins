import type { PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';

type Item = { id: string; text: string; kind: string; pinned: boolean };

const KIND: Record<string, string> = { preference: '偏好', fact: '信息', routine: '习惯', person: '人', other: '其他' };

/** AI 记忆: review, pin and delete memories. Contributed to Settings by this plugin. */
export function MemoryScreen({ host, invoke }: PluginScreenProps) {
  const { Screen, Text, ListGroup, ListRow, IconButton, Chip, EmptyState, Skeleton, FadeIn, Row, Column } = host.components;
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
    <Screen title="AI 记忆" subtitle="Memory" back>
      <FadeIn index={0}>
        <Text variant="callout" tone="muted">
          AI 会记下你提到的长期信息，回答时参考相关的几条。记忆只保存在这台手机上；置顶的记忆每次都会带上。
        </Text>
      </FadeIn>
      {error ? (
        <EmptyState icon="warning" title="读取失败" message={error} />
      ) : items == null ? (
        <Column gap="sm">
          <Skeleton height={52} />
          <Skeleton height={52} />
        </Column>
      ) : items.length === 0 ? (
        <EmptyState icon="sparkles" title="还没有记忆" message="在对话里说「记住我是信科 2024 级的」，AI 就会记下来。" />
      ) : (
        <FadeIn index={1}>
          <ListGroup title={`${items.length} 条`}>
            {items.map((m) => (
              <ListRow
                key={m.id}
                title={m.text}
                titleLines={4}
                subtitle={KIND[m.kind] ?? m.kind}
                accessory={
                  <Row gap="xs" align="center">
                    {m.pinned ? <Chip label="置顶" tone="accent" /> : null}
                    <IconButton icon="bolt" label={m.pinned ? '取消置顶' : '置顶'} variant="ghost" size={36} onPress={() => pin(m)} />
                    <IconButton icon="trash" label="删除这条记忆" variant="ghost" size={36} onPress={() => forget(m.id)} />
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
