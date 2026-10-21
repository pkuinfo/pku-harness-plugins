import { formatRelative, type HostUI, type Widget } from '@pku-harness/sdk';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';

/** AI-built widget body: skeleton → live spec; a failed refresh keeps the last value. */
function SpecBody({ host, widget, hero }: { host: HostUI; widget: Widget; hero: boolean }) {
  const { Text, Button, Icon, Skeleton, GenUI } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const data = host.useWidgetData(widget);
  // Stable spec object so the renderer keeps its state between renders.
  const spec = useMemo(() => (data.value ? { ...widget.spec, state: data.value } : null), [data.value, widget.spec]);
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="45%" height={hero ? 40 : 28} />
        <Skeleton width="70%" height={12} />
      </View>
    );
  if (data.status === 'error' || !spec)
    return (
      <View style={{ gap: t.spacing.md }}>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start' }}>
          <Icon name="warning" size={16} color={t.colors.warn} />
          <Text variant="caption" tone="muted" numberOfLines={3} style={{ flex: 1 }}>
            {data.error ?? s.noData}
          </Text>
        </View>
        <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <GenUI spec={spec} />;
}

/** Freshness of the widget's data, for the card header (AI-built widgets only; plugins show their own). */
function Freshness({ host, widget }: { host: HostUI; widget: Widget }) {
  const { Text } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(30_000);
  const data = host.useWidgetData(widget);
  if (data.fetching) return <View accessibilityLabel={s.refreshingA11y} style={[styles.dot, { backgroundColor: t.colors.accent, borderRadius: t.radius.full }]} />;
  if (data.status !== 'ready' || data.updatedAt == null) return null;
  return (
    <Text variant="micro" tone={data.error ? 'warn' : 'faint'} numberOfLines={1}>
      {data.error ? s.refreshFailed : ''}
      {formatRelative(data.updatedAt, locale, now.getTime())}
    </Text>
  );
}

/** One widget card: chrome (title, freshness, long-press to edit) around an AI-built or plugin body. */
export function WidgetCard({ host, widget, onLongPress }: { host: HostUI; widget: Widget; onLongPress: () => void }) {
  const { Text, Pressable, PluginWidget } = host.components;
  const t = host.useTheme();
  const { GlassEdges } = host.components;
  const s = strings[host.useLocale()];
  const hero = widget.size === 'lg';
  const live = !widget.source && Object.keys(widget.bindings).length > 0;
  return (
    <Pressable
      accessibilityRole="summary"
      accessibilityLabel={widget.title}
      accessibilityHint={s.cardHint}
      onLongPress={onLongPress}
      delayLongPress={350}
      scaleTo={0.98}
      haptic={false}
      style={[styles.card, { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: t.spacing.lg, gap: t.spacing.md }, hero && { paddingVertical: t.spacing.xl }]}>
      <GlassEdges radius={t.radius.lg} />
      {widget.size === 'sm' ? null : (
        <View style={[styles.head, { gap: t.spacing.sm }]}>
          <Text variant="micro" tone="faint" numberOfLines={1} style={{ flex: 1 }}>
            {widget.title.toUpperCase()}
          </Text>
          {live ? <Freshness host={host} widget={widget} /> : null}
        </View>
      )}
      {widget.source ? <PluginWidget source={widget.source} size={widget.size} /> : <SpecBody host={host} widget={widget} hero={hero} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderCurve: 'continuous' },
  head: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 6, height: 6 },
});
