import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Crowd = { name: string; diners: number; seats: number; percent: number; level: '空闲' | '适中' | '较挤' | '拥挤' };
type Result = { time: string | null; canteens: Crowd[] };

const TONE = { 空闲: 'up', 适中: 'info', 较挤: 'warn', 拥挤: 'down' } as const;

/** Live dining-hall occupancy: name, a load bar and the level, least crowded first by default. */
export function CrowdWidget({ host, size, config }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const data = host.useToolData<Result>('canteen.crowd', { sort: config.sort === 'most' ? 'most' : 'least' }, { ttlMinutes: 2 });
  const n = size === 'lg' ? 8 : size === 'sm' ? 3 : 4;
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        {Array.from({ length: Math.min(n, 4) }, (_, i) => (
          <Skeleton key={i} width="85%" height={14} />
        ))}
      </View>
    );
  const all = data.value?.canteens ?? [];
  const names = Array.isArray(config.names) ? config.names.filter((x): x is string => typeof x === 'string') : [];
  const rows = names.length ? names.map((k) => all.find((c) => c.name.includes(k))).filter((c): c is Crowd => !!c) : all;
  if (!rows.length)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? '暂时没有食堂人数数据'}
        </Text>
        <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const color = (c: Crowd) => {
    const tone = TONE[c.level];
    return tone === 'up' ? t.colors.up : tone === 'info' ? t.colors.info : tone === 'warn' ? t.colors.warn : t.colors.down;
  };
  return (
    <View style={{ gap: size === 'sm' ? t.spacing.xs : t.spacing.sm }}>
      {rows.slice(0, n).map((c) => (
        <View key={c.name} style={{ gap: t.spacing.xxs }} accessible accessibilityLabel={`${c.name}，${c.diners} 人，${c.level}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: t.spacing.sm }}>
            <Text variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>
              {c.name}
            </Text>
            <Text variant="caption" tone={TONE[c.level]}>
              {size === 'sm' ? c.level : `${c.diners}/${c.seats} · ${c.level}`}
            </Text>
          </View>
          <View style={{ height: 3, borderRadius: t.radius.full, backgroundColor: t.colors.surface3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, c.percent)}%`, height: '100%', borderRadius: t.radius.full, backgroundColor: color(c) }} />
          </View>
        </View>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.value?.time ? `数据时间 ${data.value.time.slice(11)}` : data.updatedAt ? host.formatAgo(data.updatedAt) : ''}`}
      </Text>
    </View>
  );
}
