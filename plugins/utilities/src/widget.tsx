import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Bath = { cardNo: string | null; recentTopUps: { amount: number | null; createdAt: string; status: string }[] };

/** 浴卡: last top-up and a recharge button (the balance is on the chip, not online). */
export function BathWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示浴卡
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const now = host.useNow(60_000);
  const data = host.useToolData<Bath>('utilities.bathCard', {}, { ttlMinutes: 30 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="50%" height={26} />
        <Skeleton width="35%" height={12} />
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
  const last = data.value.recentTopUps[0];
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="micro" tone="faint">
        浴卡 · 最近充值
      </Text>
      {last ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xs }}>
          <Text variant="callout" tone="muted">
            ¥
          </Text>
          <Text variant="numberL">{last.amount == null ? '—' : last.amount.toFixed(2)}</Text>
          <Text variant="caption" tone={last.status === '待支付' ? 'warn' : 'muted'}>
            {last.status}
          </Text>
        </View>
      ) : (
        <Text variant="callout" tone="muted">
          还没有线上充值记录
        </Text>
      )}
      {size !== 'sm' && last ? (
        <Text variant="caption" tone="muted">
          {last.createdAt.slice(0, 16)} · 余额在卡里，需转存机激活
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="micro" tone={data.error ? 'warn' : 'faint'} style={{ flex: 1 }}>
          {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt, now.getTime()) : ''}`}
        </Text>
        <Button title="充值" size="sm" variant="secondary" onPress={() => host.navigate('/m/utilities/bath-recharge')} />
      </View>
    </View>
  );
}
