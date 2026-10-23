import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Bath = { cardNo: string | null; recentTopUps: { amount: number | null; createdAt: string; status: string }[] };

/** 浴卡: last top-up and a recharge button (the balance is on the chip, not online). */
export function BathWidget(props: PluginWidgetProps) {
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

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const str = strings[locale];
  const now = host.useNow(60_000);
  const data = host.useToolData<Bath>('wallet.bathCard', {}, { ttlMinutes: 30 });
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
          {data.error ?? str.noData}
        </Text>
        <Button title={str.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const last = data.value.recentTopUps[0];
  return (
    <View style={{ gap: t.spacing.xs }}>
      {/* On the dashboard (md) and in the wallet hub the card title already says 浴卡. */}
      <Text variant="micro" tone="faint">
        {size === 'sm' ? str.label : str.lastTopUp}
      </Text>
      {last ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xs }}>
          <Text variant="callout" tone="muted">
            ¥
          </Text>
          <Text variant="numberL">{last.amount == null ? '—' : last.amount.toFixed(2)}</Text>
          <Text variant="caption" tone={last.status === '待支付' ? 'warn' : 'muted'}>
            {str.status[last.status] ?? last.status}
          </Text>
        </View>
      ) : (
        <Text variant="callout" tone="muted">
          {str.noTopUps}
        </Text>
      )}
      {size !== 'sm' && last ? (
        <Text variant="caption" tone="muted">
          {last.createdAt.slice(0, 16)} · {str.activate}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="micro" tone={data.error ? 'warn' : 'faint'} style={{ flex: 1 }}>
          {data.fetching ? str.refreshing : `${data.error ? str.refreshFailed : ''}${data.updatedAt ? formatRelative(data.updatedAt, locale, now.getTime()) : ''}`}
        </Text>
        <Button title={str.topUp} size="sm" variant="secondary" onPress={() => host.navigate('/m/wallet/bath-recharge')} />
      </View>
    </View>
  );
}
