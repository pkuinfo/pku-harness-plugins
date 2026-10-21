import { deliveryBlocker, type HostServices, type HostUI, type NotifyReadiness } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { strings } from './strings';

/**
 * A compact warning when reminders or checks are scheduled but the OS won't deliver them on
 * time (notifications or exact alarms off), with a one-tap fix. Permissions change in system
 * screens, so the state is re-read whenever the app is back in the foreground.
 */
export function DeliveryBanner({ host, services, active }: { host: HostUI; services: HostServices; /** Something is scheduled. */ active: boolean }) {
  const { Text, Icon, Button, FadeIn } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const [readiness, setReadiness] = useState<NotifyReadiness | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    services.notify
      .readiness()
      .then(setReadiness)
      .catch(() => {});
  }, [services]);
  useEffect(() => {
    if (!active) return;
    refresh();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && refresh());
    return () => sub.remove();
  }, [active, refresh]);

  const blocker = active && readiness ? deliveryBlocker(readiness) : null;
  if (!blocker || !readiness) return null;

  const fix = async () => {
    host.haptics.tap();
    setBusy(true);
    try {
      const next = await services.notify.fix(blocker);
      setReadiness(next);
      if (!deliveryBlocker(next)) host.haptics.success();
    } catch {
      // Left as it was; the banner stays with its button.
    } finally {
      setBusy(false);
    }
  };

  const denied = blocker === 'notifications' && readiness.notifications === 'denied';
  return (
    <FadeIn>
      <View style={[styles.banner, { backgroundColor: t.colors.warnMuted, borderRadius: t.radius.lg, gap: t.spacing.sm, paddingVertical: t.spacing.sm, paddingLeft: t.spacing.md, paddingRight: t.spacing.sm }]}>
        <Icon name="warning" size={16} color={t.colors.warn} />
        <View style={styles.text}>
          <Text variant="caption" tone="warn">
            {blocker === 'notifications' ? s.deliveryOff : s.deliveryLate}
          </Text>
        </View>
        <Button title={denied ? s.deliveryOpenSettings : s.deliveryFix} size="sm" variant="secondary" loading={busy} onPress={() => void fix()} />
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', borderCurve: 'continuous' },
  text: { flex: 1 },
});
