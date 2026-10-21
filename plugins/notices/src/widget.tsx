import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Latest = { notices: { title: string; url: string; date: string | null; source: string }[]; failed?: { source: string; error: string }[] };

/** Newest notices across the campus sources (3, or 6 when large). Tap opens the page; long-press asks the agent to summarise. */
export function LatestNoticesWidget({ host, services, size, config }: PluginWidgetProps) {
  const { Text, Skeleton, Button, Pressable } = host.components;
  const t = host.useTheme();
  const n = size === 'lg' ? 6 : 3;
  const source = typeof config.source === 'string' ? config.source : undefined;
  const data = host.useToolData<Latest>('notices.latest', { limit: n, ...(source ? { source } : {}) }, { ttlMinutes: 30 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="90%" height={16} />
        <Skeleton width="75%" height={16} />
        <Skeleton width="85%" height={16} />
      </View>
    );
  const items = data.value?.notices ?? [];
  if (!items.length)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? '暂时没有读到通知'}
        </Text>
        <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return (
    <View style={{ gap: t.spacing.md }}>
      {items.slice(0, n).map((it) => (
        <Pressable
          key={it.url}
          onPress={() => void services.browser.open(it.url)}
          onLongPress={() => host.ask(`帮我读一下这条通知并总结要点：${it.title} ${it.url}`)}
          accessibilityLabel={`${it.source}：${it.title}`}
          accessibilityRole="button"
          accessibilityHint="打开原文，长按让 AI 总结"
        >
          <View style={{ gap: t.spacing.xxs }}>
            <Text variant="callout" numberOfLines={2}>
              {it.title}
            </Text>
            <Text variant="micro" tone="faint">
              {it.source}
              {it.date ? ` · ${it.date.slice(5)}` : ''}
            </Text>
          </View>
        </Pressable>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt) : ''}`}
      </Text>
    </View>
  );
}
