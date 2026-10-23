import { parseShareLink } from '@pku-harness/cloud-protocol';
import type { PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';

import { strings } from '../strings';
import { ShareViewer, type ViewerState } from '../viewer-client';

/**
 * In-app viewer for a share link (deep link `/m/card-share/view?link=…`): decrypts on the
 * phone with the same client as the web page, so the relay's JavaScript never runs. The screen
 * is kept bright and can't be captured while open.
 */
export function ViewScreen({ host, kv, cloud, params }: PluginScreenProps) {
  const { SheetScreen, Text, QRCode, Skeleton, Field, Button, Chip, EmptyState } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  host.useSecureDisplay({ brightness: true });
  const now = host.useNow(1000).getTime();
  const [state, setState] = useState<ViewerState>({ s: 'loading' });
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const viewer = useRef<ShareViewer | null>(null);

  const link = params.link ?? params.url;
  const parsed = link ? parseShareLink(link) : undefined;
  const base = parsed?.base ?? cloud?.status().baseURL;

  useEffect(() => {
    if (!parsed || !base) return;
    const v = new ShareViewer({
      base: base.replace(/\/+$/, ''),
      channelId: parsed.channelId,
      k: parsed.k,
      fetch: globalThis.fetch.bind(globalThis),
      WebSocket: globalThis.WebSocket as never,
      store: { get: (k) => kv.get<string>(k), set: (k, v) => kv.set(k, v), delete: (k) => kv.delete(k) },
      onState: setState,
    });
    viewer.current = v;
    void v.start();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') v.want();
    });
    return () => {
      sub.remove();
      v.stop();
      viewer.current = null;
    };
    // The link is the identity of this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, base]);

  const close = () => host.dismiss('/dashboard');
  const label = (meta: { label?: string; nameHint?: string }) => meta.label ?? meta.nameHint ?? s.someone;

  const message = (icon: string, title: string, body?: string) => (
    <View style={{ paddingVertical: t.spacing.xl }}>
      <EmptyState icon={icon} title={title} message={body} />
    </View>
  );

  let body;
  if (!parsed || !base) body = message('warning', s.badLink);
  else
    switch (state.s) {
      case 'loading':
        body = (
          <View style={{ alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.lg }}>
            <Skeleton width={240} height={240} rounded={t.radius.lg} />
            <Text variant="caption" tone="muted">
              {s.loading}
            </Text>
          </View>
        );
        break;
      case 'gate': {
        const needName = state.need.includes('name');
        const needPin = state.need.includes('pin');
        const ready = (!needName || name.trim()) && (!needPin || /^\d{4,8}$/.test(pin));
        body = (
          <View style={{ gap: t.spacing.lg }}>
            <Text variant="headline">{s.gateTitle}</Text>
            <Text variant="callout" tone="muted">
              {s.from(label(state.meta))}
            </Text>
            {needName ? <Field label={s.nameField(state.meta.nameHint ?? '')} value={name} onChangeText={setName} placeholder={state.meta.nameHint} hint={s.nameFieldHint} autoCapitalize="none" autoFocus /> : null}
            {needPin ? <Field label={s.pinFieldView} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" placeholder="••••" autoCapitalize="none" /> : null}
            {state.remaining !== undefined ? (
              <Text variant="callout" tone="down">
                {s.wrong(state.remaining)}
              </Text>
            ) : null}
            <Button title={s.verify} icon="check" loading={state.busy} disabled={!ready} onPress={() => void viewer.current?.submitGate({ ...(needName ? { name } : {}), ...(needPin ? { pin } : {}) })} />
          </View>
        );
        break;
      }
      case 'waiting':
        body = (
          <View style={{ alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.lg }}>
            <Skeleton width={240} height={240} rounded={t.radius.lg} />
            <Text variant="callout" tone="muted" align="center">
              {state.ownerOnline ? s.waitingCode : s.sharerOffline}
            </Text>
          </View>
        );
        break;
      case 'live': {
        const left = Math.max(0, Math.ceil((state.receivedAt + state.refreshS * 1000 - now) / 1000));
        body = (
          <View style={{ alignItems: 'center', gap: t.spacing.xl, paddingVertical: t.spacing.lg }}>
            <QRCode value={state.code} size={240} />
            <View style={{ alignItems: 'center', gap: t.spacing.xs }}>
              <Text variant="headline">{s.showCashier}</Text>
              <Text variant="caption" tone="muted">
                {s.from(label(state.meta))}
                {state.balance != null ? ` · ${s.balance(state.balance.toFixed(2))}` : ''}
              </Text>
            </View>
            {state.ownerOnline ? <Chip label={s.refreshIn(left)} icon="refresh" /> : <Chip label={s.sharerOffline} tone="warn" icon="warning" />}
          </View>
        );
        break;
      }
      case 'paused':
        body = message('pause', s.pausedView, state.message);
        break;
      case 'capped':
        body = message('gauge', s.cappedView);
        break;
      case 'ended':
        body = message('lock', s.revokedView);
        break;
      case 'expired':
        body = message('clock', s.expiredView);
        break;
      case 'taken':
        body = message('person', s.takenView);
        break;
      case 'error':
        body = (
          <View style={{ gap: t.spacing.md, alignItems: 'center', paddingVertical: t.spacing.lg }}>
            <Text variant="callout" tone="muted" align="center">
              {state.message === 'bad_link' ? s.badLink : state.message}
            </Text>
            <Button title={s.retry} variant="secondary" icon="refresh" onPress={() => void viewer.current?.start()} />
          </View>
        );
        break;
    }

  return (
    <SheetScreen title={s.viewTitle} primary={s.close} onPrimary={close}>
      {body}
    </SheetScreen>
  );
}
