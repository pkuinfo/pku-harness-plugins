import { formatLocalDateTime, type HostUI, type PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import type { ShareManager } from '../manager';
import type { ShareRecord } from '../session';
import { strings, yuanText, type Strings } from '../strings';
import { clock, errorText, useShares } from './use-shares';

declare const __DEV__: boolean | undefined;
const DEV = typeof __DEV__ !== 'undefined' && !!__DEV__;

/** Extend adds this much from now. */
const EXTEND_S = 30 * 60;

/**
 * 付款码共享: what is being shared right now (countdown, whether the friend opened it, codes
 * shown, spend against the cap) with Stop / Extend / Reset viewer, and a short history.
 */
export function ActiveScreen(props: PluginScreenProps) {
  const { host } = props;
  const { Screen, EmptyState, Button, ListGroup, ListRow, Switch, Text, FadeIn } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(1000).getTime();
  const { manager, mock, setMock } = useShares(props);
  const [notice, setNotice] = useState<{ tone: 'up' | 'down'; text: string } | null>(null);

  const all = manager?.list() ?? [];
  const active = all.filter((r) => r.status === 'active');
  const history = all.filter((r) => r.status === 'ended');

  return (
    <Screen title={s.title} subtitle={s.subtitle} back trailing={<Button title={s.newShare} size="sm" variant="secondary" icon="plus" onPress={() => host.navigate('/m/card-share/create')} />}>
      <View style={{ gap: t.spacing.xl }}>
        {notice ? (
          <Text variant="callout" tone={notice.tone}>
            {notice.text}
          </Text>
        ) : null}

        {active.length === 0 ? (
          <EmptyState icon="share" title={s.noShares} message={s.noSharesBody} action={<Button title={s.newShare} icon="share" onPress={() => host.navigate('/m/card-share/create')} />} />
        ) : (
          active.map((r, i) => (
            <FadeIn key={r.id} index={i}>
              <ShareCard host={host} manager={manager!} record={r} now={now} s={s} onNotice={setNotice} />
            </FadeIn>
          ))
        )}

        {history.length ? (
          <ListGroup title={s.history}>
            {history.map((r) => (
              <ListRow
                key={r.id}
                icon={r.endReason === 'cap' ? 'gauge' : r.endReason === 'locked' ? 'lock' : 'clock'}
                title={formatLocalDateTime(r.createdAt, locale, now)}
                subtitle={`${s.ended(r.endReason ?? 'owner')} · ${s.codes} ${s.codesValue(r.codesIssued)}`}
                value={s.summary(yuanText(r.spent), r.payments.length)}
              />
            ))}
          </ListGroup>
        ) : null}

        {DEV ? (
          <ListGroup footer={s.devMockHint}>
            <View style={{ padding: t.spacing.md }}>
              <Switch label={s.devMock} value={mock} onValueChange={(v) => void setMock(v)} disabled={active.length > 0} />
            </View>
          </ListGroup>
        ) : null}
      </View>
    </Screen>
  );
}

function viewerLabel(r: ShareRecord, s: Strings): { label: string; tone: 'neutral' | 'accent' | 'up' | 'warn' } {
  if (!r.viewer) return { label: s.viewerWaiting, tone: 'neutral' };
  if (!r.viewer.verified) return { label: s.viewerGate, tone: 'warn' };
  return r.viewer.online ? { label: s.viewerLive, tone: 'up' } : { label: s.viewerAway, tone: 'neutral' };
}

function ShareCard({ host, manager, record: r, now, s, onNotice }: { host: HostUI; manager: ShareManager; record: ShareRecord; now: number; s: Strings; onNotice: (n: { tone: 'up' | 'down'; text: string } | null) => void }) {
  const { Glass, Text, Chip, Ring, Button, Row } = host.components;
  const t = host.useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const session = manager.get(r.id);
  const left = r.expiresAt - now;
  const total = Math.max(1, r.expiresAt - r.createdAt);
  const viewer = viewerLabel(r, s);
  const capFrac = r.capYuan ? Math.min(1, r.spent / r.capYuan) : 0;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    onNotice(null);
    try {
      await fn();
    } catch (e) {
      host.haptics.warning();
      onNotice({ tone: 'down', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const reset = () =>
    run('reset', async () => {
      await manager.resetViewer(r.id);
      host.haptics.success();
      onNotice({ tone: 'up', text: s.resetDone });
    });

  return (
    <Glass tone="strong" radius={t.radius.xl}>
      <View style={{ padding: t.spacing.lg, gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
          <Ring value={Math.max(0, left) / total} label={clock(left)} caption={s.activeTitle} tone={left < 120_000 ? 'warn' : 'accent'} size={104} />
          <View style={{ flex: 1, gap: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
              <Chip label={viewer.label} tone={viewer.tone} icon="person" />
              {r.paused ? <Chip label={s.paused} tone="warn" icon="pause" /> : null}
              {r.failures ? <Chip label={s.failures(r.failures)} tone="down" icon="lock" /> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
              <View style={{ gap: 2 }}>
                <Text variant="caption" tone="muted">
                  {s.codes}
                </Text>
                <Text variant="numberM">{s.codesValue(r.codesIssued)}</Text>
              </View>
              <View style={{ gap: 2 }}>
                <Text variant="caption" tone="muted">
                  {s.spent}
                </Text>
                <Text variant="numberM" tone={r.capYuan != null && r.spent >= r.capYuan ? 'down' : 'default'}>
                  ¥{yuanText(r.spent)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ gap: t.spacing.xs }}>
          <View style={{ height: 6, borderRadius: t.radius.full, backgroundColor: t.colors.surface3, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(capFrac * 100)}%`, height: '100%', borderRadius: t.radius.full, backgroundColor: capFrac >= 0.8 ? t.colors.warn : t.colors.accent }} />
          </View>
          <Text variant="caption" tone="faint">
            {r.capYuan != null ? s.capOf(r.capYuan) : s.noCap}
            {r.paused ? ` · ${r.paused}` : ''}
          </Text>
        </View>

        {r.payments.length ? (
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="caption" tone="muted">
              {s.payments}
            </Text>
            {r.payments.slice(-5).map((p) => (
              <Row key={p.key} align="between">
                <Text variant="callout" numberOfLines={1}>
                  {p.title}
                </Text>
                <Text variant="callout" tone="down">
                  −¥{yuanText(p.amount)}
                </Text>
              </Row>
            ))}
          </View>
        ) : null}

        <View style={{ gap: t.spacing.sm }}>
          <Button title={s.stop} variant="danger" icon="stop" loading={busy === 'stop'} onPress={() => void run('stop', () => manager.stop(r.id))} />
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Button title={s.extend} variant="secondary" size="sm" icon="clock" loading={busy === 'extend'} onPress={() => void run('extend', () => manager.extend(r.id, Math.round((left > 0 ? left / 1000 : 0) + EXTEND_S)))} style={{ flex: 1 }} />
            {session && host.shareLink ? <Button title={s.resend} variant="secondary" size="sm" icon="share" onPress={() => void host.shareLink!(session.link, { message: s.title })} style={{ flex: 1 }} /> : null}
          </View>
          {r.viewer ? <Button title={s.resetViewer} variant="ghost" size="sm" icon="refresh" loading={busy === 'reset'} onPress={() => void reset()} /> : null}
        </View>
      </View>
    </Glass>
  );
}
