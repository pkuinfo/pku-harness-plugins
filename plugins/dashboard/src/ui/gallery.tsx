import type { PluginScreenProps, WidgetCatalogEntry } from '@pku-harness/sdk';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';

/** Widgets that plugins ship, each previewed live; "添加" calls the same tool the agent uses. */
export function Gallery({ host, services, invoke }: PluginScreenProps) {
  const { SheetScreen, Text, Button, Chip, PluginWidget, EmptyState } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const { GlassEdges } = host.components;
  host.useStoreVersion();
  const catalog = services.widgets.catalog();
  const placed = new Set(services.widgets.list().map((w) => (w.source ? `${w.source.plugin}/${w.source.widget}` : '')));
  const [busy, setBusy] = useState<string | null>(null);

  const add = async (e: WidgetCatalogEntry) => {
    const key = `${e.plugin}/${e.widget}`;
    setBusy(key);
    try {
      await invoke('dashboard.addPluginWidget', { plugin: e.plugin, widget: e.widget });
      host.haptics.success();
    } finally {
      setBusy(null);
    }
  };

  return (
    <SheetScreen title={s.galleryTitle} primary={s.done} onPrimary={() => host.dismiss('/dashboard')}>
      {catalog.length === 0 ? (
        <EmptyState icon="puzzle" title={s.galleryEmpty} message={s.galleryEmptyHint} />
      ) : (
        <View style={{ gap: t.spacing.lg }}>
          <Text variant="callout" tone="muted">
            {s.galleryIntro}
          </Text>
          {catalog.map((e) => {
            const key = `${e.plugin}/${e.widget}`;
            return (
              <View key={key} style={{ gap: t.spacing.sm }}>
                <View style={[styles.head, { gap: t.spacing.sm }]}>
                  <View style={{ flex: 1, gap: t.spacing.xxs }}>
                    <Text variant="bodyStrong">{e.title}</Text>
                    <Text variant="caption" tone="muted" numberOfLines={2}>
                      {e.description}
                    </Text>
                  </View>
                  {placed.has(key) ? (
                    <Chip label={s.added} tone="up" icon="check" />
                  ) : (
                    <Button title={s.add} size="sm" icon="plus" loading={busy === key} onPress={() => void add(e)} />
                  )}
                </View>
                <View style={[styles.preview, { backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: t.spacing.lg, gap: t.spacing.sm, borderColor: t.colors.border }]}>
                  <GlassEdges radius={t.radius.lg} />
                  <Text variant="micro" tone="faint">
                    {e.pluginName}
                  </Text>
                  <PluginWidget source={{ plugin: e.plugin, widget: e.widget }} size={e.defaultSize} />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  preview: { borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth },
});
