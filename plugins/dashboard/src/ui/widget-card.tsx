import type { HostServices, HostUI, Widget } from '@pku-harness/sdk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

type Data = { status: 'loading' } | { status: 'error'; error: string } | { status: 'ready'; state: Record<string, unknown>; refreshing: boolean };

/** Loading / error / ready for one widget; `refreshToken` changes force a refetch. */
function useWidgetData(services: HostServices, w: Widget, refreshToken: number) {
  const [data, setData] = useState<Data>({ status: 'loading' });
  const first = useRef(true);
  const load = useCallback(
    (force: boolean) => {
      setData((d) => (d.status === 'ready' ? { ...d, refreshing: true } : { status: 'loading' }));
      services.widgets
        .resolve(w, force)
        .then((state) => setData({ status: 'ready', state, refreshing: false }))
        .catch((e) => setData({ status: 'error', error: e instanceof Error ? e.message : String(e) }));
    },
    [services, w],
  );
  useEffect(() => {
    const force = !first.current;
    first.current = false;
    const t = setTimeout(() => load(force), 0);
    return () => clearTimeout(t);
  }, [load, refreshToken]);
  return { data, retry: () => load(true) };
}

/** One widget: title (except small tiles), then skeleton / error with retry / live spec. */
export function WidgetCard({ host, services, widget, refreshToken, onLongPress }: { host: HostUI; services: HostServices; widget: Widget; refreshToken: number; onLongPress: () => void }) {
  const { Text, Button, Icon, Pressable, Skeleton, GenUI } = host.components;
  const t = host.useTheme();
  const { data, retry } = useWidgetData(services, widget, refreshToken);
  const hero = widget.size === 'lg';
  // Stable spec object so the renderer keeps its state between renders.
  const spec = useMemo(() => (data.status === 'ready' ? { ...widget.spec, state: data.state } : null), [data, widget.spec]);
  return (
    <Pressable
      accessibilityRole="summary"
      accessibilityLabel={widget.title}
      accessibilityHint="长按编辑看板"
      onLongPress={onLongPress}
      delayLongPress={350}
      scaleTo={0.98}
      haptic={false}
      style={[styles.card, { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: t.spacing.lg, gap: t.spacing.md }, hero && { paddingVertical: t.spacing.xl }]}>
      {widget.size === 'sm' ? null : (
        <View style={[styles.head, { gap: t.spacing.sm }]}>
          <Text variant="micro" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
            {widget.title.toUpperCase()}
          </Text>
          {data.status === 'ready' && data.refreshing ? <View style={[styles.dot, { backgroundColor: t.colors.accent, borderRadius: t.radius.full }]} /> : null}
        </View>
      )}
      {data.status === 'loading' ? (
        <View style={{ gap: t.spacing.sm }}>
          <Skeleton width="45%" height={hero ? 40 : 28} />
          <Skeleton width="70%" height={12} />
        </View>
      ) : data.status === 'error' ? (
        <View style={{ gap: t.spacing.md }}>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
            <Icon name="warning" size={16} color={t.colors.warn} />
            <Text variant="caption" tone="muted" numberOfLines={3} style={{ flex: 1 }}>
              {data.error}
            </Text>
          </View>
          <Button title="重试" size="sm" variant="secondary" icon="refresh" onPress={retry} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : spec ? (
        <GenUI spec={spec} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderCurve: 'continuous' },
  head: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 6, height: 6 },
});
