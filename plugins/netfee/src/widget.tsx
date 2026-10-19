import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Status = { balance: number | null; monthlyUsage: string | null; monthlyFee: number | null };

/** Native network-fee widget: balance plus this month's usage. */
export function NetfeeWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示网费
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const now = host.useNow(30_000);
  const data = host.useToolData<Status>('netfee.getStatus', {}, { ttlMinutes: 30 });
  if (data.status === 'loading') return <Skeleton width="50%" height={30} />;
  if (!data.value)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? '没有数据'}
        </Text>
        <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const s = data.value;
  return (
    <View style={{ gap: t.spacing.xs }}>
      {size === 'sm' ? (
        <Text variant="micro" tone="faint">
          网费
        </Text>
      ) : null}
      <Text variant={size === 'sm' ? 'numberM' : 'numberL'}>{s.balance == null ? '—' : `¥${s.balance.toFixed(2)}`}</Text>
      {size !== 'sm' && (s.monthlyUsage || s.monthlyFee != null) ? (
        <Text variant="caption" tone="muted">
          本月 {s.monthlyUsage ?? ''}
          {s.monthlyFee != null ? ` · ¥${s.monthlyFee.toFixed(2)}` : ''}
        </Text>
      ) : null}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt, now.getTime()) : ''}`}
      </Text>
    </View>
  );
}
