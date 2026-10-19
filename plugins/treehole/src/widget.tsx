import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type Feed = { status: 'ok'; holes: { pid: number; text: string; time: string; replies: number }[] } | { status: 'verification_required'; message: string };

/** The newest holes (3, or 5 when large); tap one to open the thread. */
export function LatestWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示树洞最新帖子
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button, Pressable } = host.components;
  const t = host.useTheme();
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
          {v ? '树洞需要短信验证' : (data.error ?? '没有数据')}
        </Text>
        <Button
          title={v ? '去验证' : '重试'}
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
        <Pressable key={h.pid} onPress={() => host.navigate(`/p/treehole/hole?pid=${h.pid}`)} accessibilityLabel={`树洞 ${h.pid}`} accessibilityRole="button">
          <View style={{ gap: t.spacing.xxs }}>
            <Text variant="callout" numberOfLines={2}>
              {h.text.replace(/\s+/g, ' ')}
            </Text>
            <Text variant="micro" tone="faint">
              #{h.pid} · {h.time.slice(11)} · {h.replies} 回复
            </Text>
          </View>
        </Pressable>
      ))}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? '刷新中…' : `${data.error ? '刷新失败 · ' : ''}${data.updatedAt ? host.formatAgo(data.updatedAt) : ''}`}
      </Text>
    </View>
  );
}
