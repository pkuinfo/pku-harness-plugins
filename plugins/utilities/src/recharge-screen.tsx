import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { BATH_MAX, BATH_MIN, BATH_PRESETS, checkBathAmount } from './parse';

/**
 * 浴卡充值: pick an amount; the same `utilities.rechargeBath` tool the agent uses creates the order
 * and opens the signed-in payment platform, where the user pays it with WeChat Pay or Alipay.
 */
export function BathRechargeScreen({ host, invoke }: PluginScreenProps) {
  const { SheetScreen, Text, Pressable, Field } = host.components;
  const t = host.useTheme();
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
      setNotice({ tone: 'up', text: '已在浏览器打开收费平台：到「我的订单」里付这笔待支付订单。付完拿浴卡到转存机上贴一下才到账。' });
    } catch (e) {
      host.haptics.warning();
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetScreen title="浴卡充值" primary={valid ? `充值 ¥${value}` : '充值'} onPrimary={() => void go()} primaryDisabled={!valid} loading={busy}>
      <View style={{ gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          {BATH_PRESETS.map((n) => {
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
        <Field label="其他金额（元）" value={custom} onChangeText={(v) => setCustom(v.replace(/[^\d.]/g, ''))} placeholder={`${BATH_MIN}–${BATH_MAX}`} keyboardType="decimal-pad" />
        <Text variant="caption" tone="muted">
          在学校收费平台里用微信或支付宝付款，本 App 不经手钱款。线上充值后要拿浴卡到浴卡转存机贴卡激活，钱才写进卡里。浴卡余额线上查不到。
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
