import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Status = { balance: number | null; monthlyUsage: string | null; monthlyFee: number | null };

/** Native network-fee widget: balance plus this month's usage. */
export function NetfeeWidget(props: PluginWidgetProps) {
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
  const now = host.useNow(30_000);
  const data = host.useToolData<Status>('wallet.netfeeBalance', {}, { ttlMinutes: 30 });
  if (data.status === 'loading') return <Skeleton width="50%" height={30} />;
  if (!data.value)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? str.noData}
        </Text>
        <Button title={str.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const s = data.value;
  return (
    <View style={{ gap: t.spacing.xs }}>
      {size === 'sm' ? (
        <Text variant="micro" tone="faint">
          {str.label}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xs }}>
        <Text variant="callout" tone="muted">
          ¥
        </Text>
        <Text variant={size === 'lg' ? 'numberXL' : 'numberL'}>{s.balance == null ? '—' : s.balance.toFixed(2)}</Text>
      </View>
      {size !== 'sm' && (s.monthlyUsage || s.monthlyFee != null) ? (
        <Text variant="caption" tone="muted">
          {str.thisMonth(s.monthlyUsage ?? '')}
          {s.monthlyFee != null ? ` · ¥${s.monthlyFee.toFixed(2)}` : ''}
        </Text>
      ) : null}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? str.refreshing : `${data.error ? str.refreshFailed : ''}${data.updatedAt ? formatRelative(data.updatedAt, locale, now.getTime()) : ''}`}
      </Text>
    </View>
  );
}
