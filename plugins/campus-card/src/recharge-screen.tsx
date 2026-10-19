import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { RECHARGE_MAX, RECHARGE_PRESETS } from './recharge';

/**
 * 充值: pick an amount, then the same `campus-card.recharge` tool the agent uses creates the order
 * and opens the 收银台, where the user pays with WeChat Pay or Alipay in that app.
 */
export function RechargeScreen({ host, invoke }: PluginScreenProps) {
  const { SheetScreen, Text, Pressable, Field } = host.components;
  const t = host.useTheme();
  const [amount, setAmount] = useState<number | null>(100);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'muted' | 'down' | 'up'; text: string } | null>(null);

  const value = custom ? Number(custom) : amount;
  const valid = value != null && Number.isInteger(value) && value >= 1 && value <= RECHARGE_MAX;

  const go = async () => {
    if (!valid) return;
    setBusy(true);
    setNotice(null);
    try {
      await invoke('campus-card.recharge', { amount: value });
      host.haptics.success();
      setNotice({ tone: 'up', text: '已打开收银台：选择微信或支付宝付款。付完回到这里，在 POS 机上刷一次卡余额才会更新。' });
    } catch (e) {
      host.haptics.warning();
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetScreen title="校园卡充值" primary={valid ? `充值 ¥${value}` : '充值'} onPrimary={() => void go()} primaryDisabled={!valid} loading={busy}>
      <View style={{ gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {RECHARGE_PRESETS.map((n) => {
            const on = !custom && amount === n;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`${n} 元`}
                onPress={() => {
                  setCustom('');
                  setAmount(n);
                }}
                style={{
                  flexBasis: '31%',
                  flexGrow: 1,
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
        <Field label="其他金额（元）" value={custom} onChangeText={(v) => setCustom(v.replace(/\D/g, ''))} placeholder={`1–${RECHARGE_MAX} 的整数`} keyboardType="number-pad" />
        <Text variant="caption" tone="muted">
          在学校收银台里用微信或支付宝付款，本 App 不经手钱款。充值成功后需在食堂 POS 机上刷一次卡才能到账。
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
