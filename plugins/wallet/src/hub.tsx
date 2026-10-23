import type { PluginScreenProps, PluginWidgetProps } from '@pku-harness/sdk';
import { useState, type ComponentType, type ReactNode } from 'react';
import { RefreshControl, View } from 'react-native';

import { BalanceWidget } from './card/widget';
import { NetfeeWidget } from './netfee/widget';
import { strings } from './strings';
import { ELECTRICITY_GUIDE, ELECTRICITY_GUIDE_EN } from './utilities/parse';
import { BathWidget } from './utilities/widget';

/**
 * 校园钱包: every balance on one screen. Each card is the module's own widget (same live data,
 * skeletons, errors and buttons as on the dashboard), so cards load and fail independently;
 * pull to refresh forces all of them. Payment code and top-ups open the module screens.
 */
export function WalletScreen(props: PluginScreenProps) {
  const { host, services } = props;
  const { Screen, EmptyState, Button } = host.components;
  const s = strings[host.useLocale()];
  if (!services.campus.status().signedIn)
    return (
      <Screen title={s.title} back>
        <EmptyState icon="card" title={s.signInFirst} message={s.signInWhy} action={<Button title={s.goSignIn} onPress={() => host.navigate('/campus')} />} />
      </Screen>
    );
  return <Hub {...props} />;
}

function Hub({ host, services, kv, invoke }: PluginScreenProps) {
  const { Screen, Text, Button, ListGroup, ListRow, Pressable } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const [refreshing, setRefreshing] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'up' | 'down'; text: string } | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await host.refreshAll();
    } finally {
      setRefreshing(false);
    }
  };

  const openPayCenter = async () => {
    setNotice(null);
    try {
      await invoke('wallet.openPayCenter');
      setNotice({ tone: 'up', text: s.opened });
    } catch (e) {
      host.haptics.warning();
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const widget = (Component: ComponentType<PluginWidgetProps>, size: PluginWidgetProps['size']) => (
    <Component host={host} services={services} kv={kv} invoke={invoke} size={size} config={{}} />
  );

  return (
    <Screen title={s.title} subtitle={s.subtitle} back refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={{ gap: t.spacing.lg }}>
        <Card host={host} index={0} icon="card" title={s.card}>
          {widget(BalanceWidget, 'lg')}
        </Card>
        <Card host={host} index={1} icon="wifi" title={s.netfee}>
          {widget(NetfeeWidget, 'md')}
          {/* Note above the action: side by side, a long label squeezed the note into a sliver. */}
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {s.netfeeNote}
            </Text>
            <Button title={s.payNetfee} size="sm" variant="secondary" icon="card" onPress={() => void openPayCenter()} style={{ alignSelf: 'flex-start' }} />
          </View>
        </Card>
        <Card host={host} index={2} icon="drop" title={s.bath}>
          {widget(BathWidget, 'md')}
        </Card>
        <Card host={host} index={3} icon="bolt" title={s.electricity}>
          <Text variant="caption" tone="faint">
            {s.electricityNote}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={guideOpen ? s.showLess : s.showMore} onPress={() => setGuideOpen((v) => !v)}>
            <Text variant="callout" tone="muted" numberOfLines={guideOpen ? undefined : 3}>
              {locale === 'en' ? ELECTRICITY_GUIDE_EN : ELECTRICITY_GUIDE}
            </Text>
            <Text variant="caption" tone="accent" style={{ marginTop: t.spacing.xs }}>
              {guideOpen ? s.showLess : s.showMore}
            </Text>
          </Pressable>
        </Card>
        {notice ? (
          <Text variant="callout" tone={notice.tone}>
            {notice.text}
          </Text>
        ) : null}
        <ListGroup title={s.more} footer={s.footer}>
          <ListRow icon="chart" title={s.monthly} chevron onPress={() => host.ask(s.monthlyPrompt)} />
          <ListRow icon="todo" title={s.transactions} chevron onPress={() => host.ask(s.transactionsPrompt)} />
          <ListRow icon="globe" title={s.payCenter} subtitle={s.payCenterSubtitle} chevron onPress={() => void openPayCenter()} />
        </ListGroup>
      </View>
    </Screen>
  );
}

/** One balance: glass panel, icon + title, then the module's content. */
function Card({ host, index, icon, title, children }: { host: PluginScreenProps['host']; index: number; icon: string; title: string; children: ReactNode }) {
  const { Glass, FadeIn, Icon, Text } = host.components;
  const t = host.useTheme();
  return (
    <FadeIn index={index}>
      <Glass radius={t.radius.xl}>
        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <Icon name={icon} size={18} color={t.colors.textMuted} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {title}
            </Text>
          </View>
          {children}
        </View>
      </Glass>
    </FadeIn>
  );
}
