import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Crowd = { name: string; diners: number; seats: number; percent: number; level: '空闲' | '适中' | '较挤' | '拥挤' };
type Result = { time: string | null; canteens: Crowd[] };

const TONE = { 空闲: 'up', 适中: 'info', 较挤: 'warn', 拥挤: 'down' } as const;

/** Live dining-hall occupancy: name, a load bar and the level, least crowded first by default. */
export function CrowdWidget({ host, size, config }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
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
          {data.error ?? s.noData}
        </Text>
        <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const color = (c: Crowd) => {
    const tone = TONE[c.level];
    return tone === 'up' ? t.colors.up : tone === 'info' ? t.colors.info : tone === 'warn' ? t.colors.warn : t.colors.down;
  };
  return (
    <View style={{ gap: size === 'sm' ? t.spacing.xs : t.spacing.sm }}>
      {rows.slice(0, n).map((c) => (
        <View key={c.name} style={{ gap: t.spacing.xxs }} accessible accessibilityLabel={s.a11y(c.name, c.diners, s.levels[c.level])}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: t.spacing.sm }}>
            <Text variant="callout" numberOfLines={1} style={{ flexShrink: 1 }}>
              {c.name}
            </Text>
            <Text variant="caption" tone={TONE[c.level]}>
              {size === 'sm' ? s.levels[c.level] : `${c.diners}/${c.seats} · ${s.levels[c.level]}`}
            </Text>
          </View>
          <View style={{ height: 3, borderRadius: t.radius.full, backgroundColor: t.colors.surface3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(100, c.percent)}%`, height: '100%', borderRadius: t.radius.full, backgroundColor: color(c) }} />
          </View>
        </View>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? s.refreshing : `${data.error ? s.refreshFailed : ''}${data.value?.time ? s.dataTime(data.value.time.slice(11)) : data.updatedAt ? formatRelative(data.updatedAt, locale) : ''}`}
      </Text>
    </View>
  );
}
