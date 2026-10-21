import type { PluginScreenProps, Widget, WidgetSize } from '@pku-harness/sdk';
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { Greeting } from './greeting';
import { strings } from './strings';
import { WidgetCard } from './widget-card';

const NEXT_SIZE: Record<WidgetSize, WidgetSize> = { sm: 'md', md: 'lg', lg: 'sm' };
const ROW = 64;

/** Dashboard tab: widgets the agent builds and the user arranges. Contributed to the harness's dashboard slot. */
export function DashboardTab({ host, services }: PluginScreenProps) {
  const { Screen, Text, Button, IconButton, EmptyState, Pressable, FadeIn, Chip, SortableList } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const { GlassEdges } = host.components;
  host.useStoreVersion();
  const widgets = services.widgets.list();
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const hasGallery = services.widgets.catalog().length > 0;

  const columns = t.contentWidth >= 700 ? 3 : 2;
  const gridWidth = t.contentWidth - t.spacing.lg * 2;
  const small = (gridWidth - t.spacing.md * (columns - 1)) / columns;
  const widthOf = (size: WidgetSize) => (size === 'sm' ? small : gridWidth);

  const enterEdit = () => {
    host.haptics.tap();
    setEditing(true);
  };
  // Pull-to-refresh forces every widget on screen and ends when the requests settle.
  const refresh = async () => {
    setRefreshing(true);
    await host.refreshAll();
    setRefreshing(false);
  };
  const remove = (w: Widget) => {
    host.haptics.warning();
    services.widgets.remove(w.id);
  };
  const resize = (w: Widget) => {
    host.haptics.select();
    services.widgets.put({ ...w, size: NEXT_SIZE[w.size], updatedAt: Date.now() });
  };

  return (
    <Screen
      title={s.title}
      subtitle={s.subtitle || undefined}
      trailing={
        widgets.length ? (
          editing ? (
            <Button title={s.done} size="sm" onPress={() => setEditing(false)} />
          ) : (
            <View style={{ flexDirection: 'row' }}>
              {hasGallery ? <IconButton icon="plus" label={s.addWidget} variant="ghost" onPress={() => host.navigate('/m/dashboard/gallery')} /> : null}
              <IconButton icon="edit" label={s.editDashboard} variant="ghost" onPress={enterEdit} />
            </View>
          )
        ) : null
      }
      refreshControl={
        editing ? undefined : (
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={t.colors.accent} colors={[t.colors.accent]} progressBackgroundColor={t.colors.surface} />
        )
      }>
      {editing ? null : <Greeting host={host} services={services} />}
      {widgets.length === 0 ? (
        <FadeIn>
          <View style={{ gap: t.spacing.lg }}>
            <EmptyState
              icon="sparkles"
              title={s.emptyTitle}
              message={s.emptyMessage}
              action={hasGallery ? <Button title={s.addFromPlugins} variant="secondary" icon="plus" onPress={() => host.navigate('/m/dashboard/gallery')} /> : undefined}
            />
            <View style={{ gap: t.spacing.sm }}>
              {s.ideas.map((idea) => (
                <Pressable
                  key={idea}
                  accessibilityRole="button"
                  accessibilityLabel={idea}
                  onPress={() => host.ask(idea)}
                  style={[styles.idea, { backgroundColor: t.colors.surface, padding: t.spacing.lg, borderRadius: t.radius.lg, gap: t.spacing.md }]}>
                  <GlassEdges radius={t.radius.lg} />
                  <Text variant="callout" style={{ flex: 1 }}>
                    {idea}
                  </Text>
                  <Text variant="callout" tone="accent">
                    {s.askAI}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </FadeIn>
      ) : editing ? (
        <FadeIn>
          <View style={{ gap: t.spacing.lg }}>
            <Text variant="callout" tone="muted">
              {s.editHint}
            </Text>
            <SortableList
              key={widgets.map((w) => w.id).sort().join()}
              ids={widgets.map((w) => w.id)}
              rowHeight={ROW}
              onReorder={(ids) => services.widgets.reorder(ids)}
              renderRow={(id, handle) => {
                const w = widgets.find((x) => x.id === id);
                if (!w) return null;
                return (
                  <View style={[styles.row, { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, gap: t.spacing.md, paddingRight: t.spacing.md, height: ROW }]}>
                    <GlassEdges radius={t.radius.lg} />
                    {handle}
                    <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
                      {w.title}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={s.resizeA11y(s.sizes[w.size])} onPress={() => resize(w)}>
                      <Chip label={s.sizes[w.size]} />
                    </Pressable>
                    <IconButton icon="trash" label={s.remove(w.title)} variant="danger" size={36} onPress={() => remove(w)} />
                  </View>
                );
              }}
            />
          </View>
        </FadeIn>
      ) : (
        <View style={[styles.grid, { gap: t.spacing.md }]}>
          {widgets.map((w, i) => (
            <FadeIn key={w.id} index={i} style={{ width: widthOf(w.size) }}>
              <WidgetCard host={host} widget={w} onLongPress={enterEdit} />
            </FadeIn>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={s.askToAdd}
            onPress={() => host.navigate('/')}
            style={[styles.add, { borderColor: t.colors.border, width: gridWidth, padding: t.spacing.lg, borderRadius: t.radius.lg }]}>
            <Text variant="callout" tone="muted">
              {s.askToAddLong}
            </Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  idea: { flexDirection: 'row', alignItems: 'center', borderCurve: 'continuous' },
  row: { flexDirection: 'row', alignItems: 'center', borderCurve: 'continuous' },
  add: { alignItems: 'center', borderCurve: 'continuous', borderWidth: 1, borderStyle: 'dashed' },
});
