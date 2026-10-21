import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Fees = { settled: boolean; totals: { due: number; paid: number; unpaid: number }; items: { year: string; item: string; unpaid: number | null }[] };

/** 学费住宿费: the unpaid total from the payment platform, or 已缴清. */
export function FeesWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示学费住宿费
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button, Chip } = host.components;
  const t = host.useTheme();
  const now = host.useNow(60_000);
  const data = host.useToolData<Fees>('finance.tuitionFees', {}, { ttlMinutes: 360 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="50%" height={30} />
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
  const f = data.value;
  const owing = f.items.filter((i) => (i.unpaid ?? 0) > 0);
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="micro" tone="faint">
        {f.settled ? '学费住宿费' : '学费住宿费未缴'}
      </Text>
      {f.settled ? (
        <Chip label="已缴清" tone="up" icon="check" />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xs }}>
          <Text variant="callout" tone="warn">
            ¥
          </Text>
          <Text variant="numberL" tone="warn">
            {f.totals.unpaid.toFixed(2)}
          </Text>
        </View>
      )}
      {size !== 'sm' && owing.length ? (
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {owing.map((i) => `${i.year} ${i.item}`).join('、')}
        </Text>
      ) : null}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt, now.getTime()) : ''}`}
      </Text>
    </View>
  );
}
