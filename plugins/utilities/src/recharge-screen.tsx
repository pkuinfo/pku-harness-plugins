import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { BATH_MAX, BATH_MIN, BATH_PRESETS, checkBathAmount } from './parse';
import { strings } from './strings';

/**
 * 浴卡充值: pick an amount; the same `utilities.rechargeBath` tool the agent uses creates the order
 * and opens the signed-in payment platform, where the user pays it with WeChat Pay or Alipay.
 */
export function BathRechargeScreen({ host, invoke }: PluginScreenProps) {
  const { SheetScreen, Text, Pressable, Field } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const [amount, setAmount] = useState<number | null>(50);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'muted' | 'down' | 'up'; text: string } | null>(null);

  const value = custom ? Number(custom) : amount;
  const valid = value != null && checkBathAmount(value) == null;

  const go = async () => {
    if (!valid) return;
    setBusy(true);
    setNotice(null);
    try {
      await invoke('utilities.rechargeBath', { amount: value });
      host.haptics.success();
      setNotice({ tone: 'up', text: s.opened });
    } catch (e) {
      host.haptics.warning();
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetScreen title={s.rechargeTitle} primary={valid ? s.rechargeAmount(value) : s.topUp} onPrimary={() => void go()} primaryDisabled={!valid} loading={busy}>
      <View style={{ gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          {BATH_PRESETS.map((n) => {
            const on = !custom && amount === n;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={s.yuan(n)}
                onPress={() => {
                  setCustom('');
                  setAmount(n);
                }}
                style={{
                  flex: 1,
                  paddingVertical: t.spacing.lg,
                  alignItems: 'center',
                  borderRadius: t.radius.lg,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : t.colors.border,
                  backgroundColor: on ? t.colors.accentMuted : t.colors.surface,
                }}
              >
                <Text variant="numberM" tone={on ? 'accent' : 'default'}>
                  ¥{n}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Field label={s.otherAmount} value={custom} onChangeText={(v) => setCustom(v.replace(/[^\d.]/g, ''))} placeholder={`${BATH_MIN}–${BATH_MAX}`} keyboardType="decimal-pad" />
        <Text variant="caption" tone="muted">
          {s.rechargeNote}
        </Text>
        {notice ? (
          <Text variant="callout" tone={notice.tone}>
            {notice.text}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}
