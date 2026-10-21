import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Overview = { buildings: { building: string; free: number; total: number }[] };

/** Free classrooms per teaching building right now; tap a building to ask the agent for rooms. */
export function FreeClassroomsWidget({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button, Pressable } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const data = host.useToolData<Overview>('classrooms.overview', {}, { ttlMinutes: 10 });
  const n = size === 'lg' ? 10 : size === 'sm' ? 3 : 5;
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="80%" height={14} />
        <Skeleton width="70%" height={14} />
        <Skeleton width="75%" height={14} />
      </View>
    );
  const rows = data.value?.buildings ?? [];
  if (!rows.length)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? s.noData}
        </Text>
        <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return (
    <View style={{ gap: t.spacing.sm }}>
      {rows.slice(0, n).map((b) => (
        <Pressable key={b.building} onPress={() => host.ask(s.ask(b.building))} accessibilityRole="button" accessibilityLabel={s.a11y(b.building, b.free, b.total)}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text variant="callout">{b.building}</Text>
            <Text variant="caption" tone={b.free > 0 ? 'up' : 'muted'}>
              {b.free}
              <Text variant="caption" tone="faint">
                {` / ${b.total}`}
              </Text>
            </Text>
          </View>
        </Pressable>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? s.refreshing : `${data.error ? s.refreshFailed : s.freeNow}${data.updatedAt ? formatRelative(data.updatedAt, locale) : ''}`}
      </Text>
    </View>
  );
}
