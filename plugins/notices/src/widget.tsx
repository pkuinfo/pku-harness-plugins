import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Latest = { notices: { title: string; url: string; date: string | null; source: string }[]; failed?: { source: string; error: string }[] };

/** Newest notices across the campus sources (3, or 6 when large). Tap opens the page; long-press asks the agent to summarise. */
export function LatestNoticesWidget({ host, services, size, config }: PluginWidgetProps) {
  const { Text, Skeleton, Button, Pressable } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const sourceName = (name: string) => s.sources[name] ?? name;
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
          {data.error ?? s.noData}
        </Text>
        <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return (
    <View style={{ gap: t.spacing.md }}>
      {items.slice(0, n).map((it) => (
        <Pressable
          key={it.url}
          onPress={() => void services.browser.open(it.url)}
          onLongPress={() => host.ask(s.summarise(it.title, it.url))}
          accessibilityLabel={`${sourceName(it.source)}: ${it.title}`}
          accessibilityRole="button"
          accessibilityHint={s.hint}
        >
          <View style={{ gap: t.spacing.xxs }}>
            <Text variant="callout" numberOfLines={2}>
              {it.title}
            </Text>
            <Text variant="micro" tone="faint">
              {sourceName(it.source)}
              {it.date ? ` · ${it.date.slice(5)}` : ''}
            </Text>
          </View>
        </Pressable>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? s.refreshing : `${data.error ? s.refreshFailed : ''}${data.updatedAt ? formatRelative(data.updatedAt, locale) : ''}`}
      </Text>
    </View>
  );
}
