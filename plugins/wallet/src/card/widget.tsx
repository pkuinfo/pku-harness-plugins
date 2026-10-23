import { formatRelative, type LiveData, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Balance = { balance: number | null; status: 'normal' | 'lost' | 'frozen'; todaySpent: number | null; dailyLimit: number | null };

/** Native balance widget: signed-out prompt, then the live balance with today's spending. */
export function BalanceWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {s.signedOut}
        </Text>
        <Button title={s.signIn} size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size, config }: PluginWidgetProps) {
  const { Text, Skeleton, Chip, Button } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(30_000);
  const data: LiveData<Balance> = host.useToolData<Balance>('wallet.cardBalance', {}, { ttlMinutes: 10 });
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
          {data.error ?? s.noData}
        </Text>
        <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const b = data.value;
  const low = b.balance != null && b.balance < warnBelow;
  return (
    <View style={{ gap: t.spacing.xs }}>
      {size === 'sm' ? (
        <Text variant="micro" tone="faint">
          {s.label}
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
      {b.status !== 'normal' ? <Chip label={b.status === 'lost' ? s.lost : s.frozen} tone="down" icon="warning" /> : null}
      {size !== 'sm' && b.todaySpent != null ? (
        <Text variant="caption" tone="muted">
          {s.todaySpent(b.todaySpent.toFixed(2))}
          {b.dailyLimit ? s.dailyLimit(b.dailyLimit.toFixed(0)) : ''}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="micro" tone={data.error ? 'warn' : 'faint'} style={{ flex: 1 }}>
          {data.fetching ? s.refreshing : `${data.error ? s.refreshFailed : ''}${data.updatedAt ? formatRelative(data.updatedAt, locale, now.getTime()) : ''}`}
        </Text>
        {size !== 'sm' ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
            <Button title={s.topUp} size="sm" variant="secondary" onPress={() => host.navigate('/m/wallet/recharge')} />
            <Button title={s.payCode} size="sm" icon="qr" onPress={() => host.navigate('/m/wallet/pay')} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
