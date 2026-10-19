import type { PluginScreenProps, WidgetCatalogEntry } from '@pku-harness/sdk';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

/** Widgets that plugins ship, each previewed live; "添加" calls the same tool the agent uses. */
export function Gallery({ host, services, invoke }: PluginScreenProps) {
  const { SheetScreen, Text, Button, Chip, PluginWidget, EmptyState } = host.components;
  const t = host.useTheme();
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
    <SheetScreen title="添加组件" primary="完成" onPrimary={() => host.dismiss('/dashboard')}>
      {catalog.length === 0 ? (
        <EmptyState icon="puzzle" title="还没有插件提供组件" message="安装或开启带看板组件的插件后，会出现在这里。" />
      ) : (
        <View style={{ gap: t.spacing.lg }}>
          <Text variant="callout" tone="muted">
            插件自带的原生组件。想要别的数字，直接在对话里让 AI 搭一个。
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
                    <Chip label="已添加" tone="up" icon="check" />
                  ) : (
                    <Button title="添加" size="sm" icon="plus" loading={busy === key} onPress={() => void add(e)} />
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
