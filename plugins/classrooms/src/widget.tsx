import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Overview = { buildings: { building: string; free: number; total: number }[] };

/** Free classrooms per teaching building right now; tap a building to ask the agent for rooms. */
export function FreeClassroomsWidget({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button, Pressable } = host.components;
  const t = host.useTheme();
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
          {data.error ?? '暂时没有教室数据'}
        </Text>
        <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return (
    <View style={{ gap: t.spacing.sm }}>
      {rows.slice(0, n).map((b) => (
        <Pressable key={b.building} onPress={() => host.ask(`${b.building}现在有哪些空闲教室？`)} accessibilityRole="button" accessibilityLabel={`${b.building}，${b.free} 间空闲，共 ${b.total} 间`}>
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
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : '现在空闲 · '}${data.updatedAt ? host.formatAgo(data.updatedAt) : ''}`}
      </Text>
    </View>
  );
}
