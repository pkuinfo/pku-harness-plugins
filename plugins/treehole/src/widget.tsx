import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Feed = { status: 'ok'; holes: { pid: number; text: string; time: string; replies: number }[] } | { status: 'verification_required'; message: string };

/** The newest holes (3, or 5 when large); tap one to open the thread. */
export function LatestWidget(props: PluginWidgetProps) {
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
  const { Text, Skeleton, Button, Pressable } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const n = size === 'lg' ? 5 : 3;
  const data = host.useToolData<Feed>('treehole.latest', { limit: n }, { ttlMinutes: 10 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="90%" height={16} />
        <Skeleton width="70%" height={16} />
        <Skeleton width="80%" height={16} />
      </View>
    );
  const v = data.value;
  if (!v || v.status !== 'ok')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {v ? s.widgetVerify : (data.error ?? s.noData)}
        </Text>
        <Button
          title={v ? s.goVerify : s.retry}
          size="sm"
          variant="secondary"
          icon={v ? 'shield' : 'refresh'}
          loading={!v && data.fetching}
          onPress={() => (v ? host.navigate('/p/treehole/home') : void data.refresh())}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
    );
  return (
    <View style={{ gap: t.spacing.md }}>
      {v.holes.slice(0, n).map((h) => (
        <Pressable key={h.pid} onPress={() => host.navigate(`/p/treehole/hole?pid=${h.pid}`)} accessibilityLabel={s.holeA11y(h.pid)} accessibilityRole="button">
          <View style={{ gap: t.spacing.xxs }}>
            <Text variant="callout" numberOfLines={2}>
              {h.text.replace(/\s+/g, ' ')}
            </Text>
            <Text variant="micro" tone="faint">
              #{h.pid} · {h.time.slice(11)} · {s.replies(h.replies)}
            </Text>
          </View>
        </Pressable>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? s.refreshing : `${data.error ? s.refreshFailed : ''}${data.updatedAt ? formatRelative(data.updatedAt, locale) : ''}`}
      </Text>
    </View>
  );
}
