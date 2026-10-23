import type { PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { cardAccount, conflictNotice, paymentCode, cardMode } from '@pku-harness/campus-card';
import { strings } from './strings';

/** The code is short-lived; fetch a fresh one this often while the screen is open. */
const REFRESH_S = 30;

type State =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'switch'; account: string; current: string; notice: string | null }
  | { step: 'code'; account: string; code: string; name: string; balance: number | null; at: number };

/**
 * Payment code for the canteen POS. Fetched straight from the card service into this screen:
 * never a tool result, so it never reaches the model provider. Screenshots are blocked and the
 * screen is brightened while it is open.
 */
export function PayScreen({ host, services, invoke }: PluginScreenProps) {
  const { SheetScreen, Text, Button, QRCode, Skeleton, Chip } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  host.useSecureDisplay({ brightness: true });
  const now = host.useNow(1000);
  const [state, setState] = useState<State>({ step: 'loading' });
  const [busy, setBusy] = useState(false);
  const account = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const acc = account.current ?? (account.current = await cardAccount(services));
      const config = await cardMode(services);
      if (!config.digital) {
        setState({ step: 'switch', account: acc, current: config.name, notice: await conflictNotice(services, acc).catch(() => null) });
        return;
      }
      const p = await paymentCode(services, acc);
      setState({ step: 'code', account: acc, ...p, at: Date.now() });
    } catch (e) {
      setState({ step: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [services]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const age = state.step === 'code' ? Math.floor((now.getTime() - state.at) / 1000) : 0;
  useEffect(() => {
    if (state.step === 'code' && age >= REFRESH_S) void load();
  }, [state.step, age, load]);

  const switchCard = async () => {
    setBusy(true);
    try {
      await invoke('wallet.cardSetDigital');
      host.haptics.success();
      setState({ step: 'loading' });
      await load();
    } catch (e) {
      setState({ step: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!services.campus.status().signedIn)
    return (
      <SheetScreen title={s.payTitle} primary={s.signInCampus} onPrimary={() => host.navigate('/campus')}>
        <Text variant="callout" tone="muted">
          {s.paySignedOut}
        </Text>
      </SheetScreen>
    );

  return (
    <SheetScreen title={s.payTitle} primary={s.done} onPrimary={() => host.dismiss('/dashboard')}>
      <View style={{ gap: t.spacing.xl, alignItems: 'center', paddingVertical: t.spacing.lg }}>
        {state.step === 'loading' ? (
          <Skeleton width={252} height={252} rounded={t.radius.lg} />
        ) : state.step === 'error' ? (
          <View style={{ gap: t.spacing.md, alignItems: 'center' }}>
            <Text variant="callout" tone="muted" align="center">
              {state.message}
            </Text>
            <Button title={s.retry} variant="secondary" icon="refresh" onPress={() => void load()} />
          </View>
        ) : state.step === 'switch' ? (
          <View style={{ gap: t.spacing.md, alignSelf: 'stretch' }}>
            <Text variant="headline">{s.switchTitle}</Text>
            <Text variant="callout" tone="muted">
              {s.switchBody(state.current)}
            </Text>
            {state.notice ? (
              <Text variant="caption" tone="warn">
                {state.notice}
              </Text>
            ) : null}
            <Button title={s.switchButton} icon="card" loading={busy} onPress={() => void switchCard()} />
          </View>
        ) : (
          <>
            <QRCode value={state.code} size={220} />
            <View style={{ alignItems: 'center', gap: t.spacing.xs }}>
              <Text variant="numberL">{state.balance == null ? '—' : `¥${state.balance.toFixed(2)}`}</Text>
              <Text variant="caption" tone="muted">
                {s.showCashier(state.name)}
              </Text>
            </View>
            <Chip label={s.refreshIn(Math.max(0, REFRESH_S - age))} icon="refresh" />
          </>
        )}
      </View>
    </SheetScreen>
  );
}
