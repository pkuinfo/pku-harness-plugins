import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Item = { title: string; course: string; deadline: number | null; submitted: boolean; contentId: string };

const left = (ms: number, now: number) => {
  const h = Math.floor((ms - now) / 3600_000);
  if (h < 1) return '不到 1 小时';
  if (h < 48) return `${h} 小时`;
  return `${Math.floor(h / 24)} 天`;
};

/** Unsubmitted assignments by deadline; crawling is slow, so the data stays fresh for 2 hours. */
export function DueWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示作业截止时间
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const now = host.useNow(60_000).getTime();
  const data = host.useToolData<Item[]>('courses.assignments', {}, { ttlMinutes: 120 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="80%" height={16} />
        <Skeleton width="60%" height={16} />
      </View>
    );
  if (!data.value)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? '没有数据'}
        </Text>
        <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const due = data.value.filter((a) => !a.submitted).slice(0, size === 'lg' ? 6 : 3);
  if (!due.length)
    return (
      <Text variant="callout" tone="up">
        没有待交的作业
      </Text>
    );
  return (
    <View style={{ gap: t.spacing.md }}>
      {due.map((a) => {
        const urgent = a.deadline != null && a.deadline - now < 24 * 3600_000;
        return (
          <View key={a.contentId} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <View style={{ flex: 1, gap: t.spacing.xxs }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {a.title}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {a.course}
              </Text>
            </View>
            <Text variant="callout" tone={urgent ? 'down' : 'muted'}>
              {a.deadline == null ? '无截止' : `剩 ${left(a.deadline, now)}`}
            </Text>
          </View>
        );
      })}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt, now) : ''}`}
      </Text>
    </View>
  );
}
