import type { LiveData, PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Balance = { balance: number | null; status: 'normal' | 'lost' | 'frozen'; todaySpent: number | null; dailyLimit: number | null };

/** Native balance widget: signed-out prompt, then the live balance with today's spending. */
export function BalanceWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示余额
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size, config }: PluginWidgetProps) {
  const { Text, Skeleton, Chip, Button } = host.components;
  const t = host.useTheme();
  const now = host.useNow(30_000);
  const data: LiveData<Balance> = host.useToolData<Balance>('campus-card.getBalance', {}, { ttlMinutes: 10 });
  const warnBelow = typeof config.warnBelow === 'number' ? config.warnBelow : 50;
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="55%" height={size === 'lg' ? 40 : 30} />
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
  const b = data.value;
  const low = b.balance != null && b.balance < warnBelow;
  return (
    <View style={{ gap: t.spacing.xs }}>
      {size === 'sm' ? (
        <Text variant="micro" tone="faint">
          校园卡
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xs }}>
        <Text variant="callout" tone={low ? 'warn' : 'muted'}>
          ¥
        </Text>
        <Text variant={size === 'lg' ? 'numberXL' : 'numberL'} tone={low ? 'warn' : 'default'}>
          {b.balance == null ? '—' : b.balance.toFixed(2)}
        </Text>
      </View>
      {b.status !== 'normal' ? <Chip label={b.status === 'lost' ? '已挂失' : '已冻结'} tone="down" icon="warning" /> : null}
      {size !== 'sm' && b.todaySpent != null ? (
        <Text variant="caption" tone="muted">
          今日消费 ¥{b.todaySpent.toFixed(2)}
          {b.dailyLimit ? ` / 限额 ¥${b.dailyLimit.toFixed(0)}` : ''}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="micro" tone={data.error ? 'warn' : 'faint'} style={{ flex: 1 }}>
          {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt, now.getTime()) : ''}`}
        </Text>
        {size !== 'sm' ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
            <Button title="充值" size="sm" variant="secondary" onPress={() => host.navigate('/m/campus-card/recharge')} />
            <Button title="付款码" size="sm" icon="qr" onPress={() => host.navigate('/m/campus-card/pay')} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
