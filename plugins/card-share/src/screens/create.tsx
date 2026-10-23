import { isCloudError, type PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DRAFT_KEY } from '../manager';
import { defaultHidden, isValidPin, maskName, nameChars } from '../gates';
import { NotDigitalError } from '../source';
import { CAP_PRESETS, strings, TTL_PRESETS, ttlSeconds, type TtlPreset } from '../strings';
import { draftSchema } from '../tools';
import { errorText, useShares } from './use-shares';

type Problem = { text: string; action?: { label: string; href: string } };

/** Drafts from the agent (`card-share.start`) older than this are ignored. */
const DRAFT_TTL_MS = 30 * 60_000;

/**
 * 分享付款码: choose how long, a spend cap and the viewer checks, then get a link to send and a
 * QR to show. Starting a share is always the user's tap here; the agent can only prefill it.
 */
export function CreateScreen(props: PluginScreenProps) {
  const { host, services, kv, cloud } = props;
  const { SheetScreen, Text, Segmented, Switch, Field, ListGroup, Glass, Icon, Pressable, Button, QRCode, Skeleton } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const { manager } = useShares(props);

  const [ttl, setTtl] = useState<TtlPreset>('30m');
  const [cap, setCap] = useState<string>('50');
  const [nameOn, setNameOn] = useState(false);
  const [holder, setHolder] = useState<string | null | undefined>(undefined);
  const [hidden, setHidden] = useState<number[]>([]);
  const [pinOn, setPinOn] = useState(false);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);

  // Agent draft → prefill once.
  useEffect(() => {
    void kv.get(DRAFT_KEY).then(async (raw) => {
      const d = draftSchema.safeParse(raw);
      if (!d.success) return;
      await kv.delete(DRAFT_KEY);
      if (Date.now() - d.data.at > DRAFT_TTL_MS) return;
      if (d.data.ttl) setTtl(d.data.ttl);
      if (d.data.capYuan !== undefined) setCap(d.data.capYuan === null ? 'none' : String(d.data.capYuan));
      if (d.data.nameCheck) setNameOn(true);
      if (d.data.pin) setPinOn(true);
    });
  }, [kv]);

  // Holder name for the masked-name gate, fetched when the gate is first turned on.
  useEffect(() => {
    if (!nameOn || holder !== undefined || !manager) return;
    void manager.source
      .holder()
      .then((n) => {
        setHolder(n || null);
        if (n) setHidden(defaultHidden(n));
      })
      .catch(() => setHolder(null));
  }, [nameOn, holder, manager]);

  const session = shareId ? manager?.get(shareId) : undefined;

  if (!services.campus.status().signedIn)
    return (
      <SheetScreen title={s.createTitle} primary={s.signIn} onPrimary={() => host.navigate('/campus')}>
        <Text variant="callout" tone="muted">
          {s.needSignIn}
        </Text>
      </SheetScreen>
    );

  if (!cloud)
    return (
      <SheetScreen title={s.createTitle} primary={s.close} onPrimary={() => host.dismiss('/dashboard')}>
        <Text variant="callout" tone="muted">
          {s.noCloud}
        </Text>
      </SheetScreen>
    );

  // ── ready: link + QR ──────────────────────────────────────────────────────────────────────
  if (session) {
    const send = host.shareLink;
    return (
      <SheetScreen title={s.readyTitle} primary={s.done} onPrimary={() => host.dismiss('/p/card-share/active')} secondary={s.viewStatus} onSecondary={() => host.navigate('/p/card-share/active')}>
        <View style={{ gap: t.spacing.xl, alignItems: 'center', paddingVertical: t.spacing.md }}>
          <QRCode link={session.link} size={220} ecl="M" />
          <Text variant="callout" tone="muted" align="center">
            {s.readyBody}
          </Text>
          {send ? <Button title={s.send} icon="share" size="lg" onPress={() => void send(session.link, { message: `${s.title} · ${s.ttlLabel[ttl]}` })} style={{ alignSelf: 'stretch' }} /> : null}
          <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start', alignSelf: 'stretch' }}>
            <Icon name="bell" size={16} color={t.colors.textFaint} />
            <View style={{ flex: 1 }}>
              <Text variant="caption" tone="faint">
                {services.ongoing ? s.keepOpen : s.keepOpenIos}
              </Text>
            </View>
          </View>
        </View>
      </SheetScreen>
    );
  }

  // ── form ──────────────────────────────────────────────────────────────────────────────────
  const capYuan = cap === 'none' ? null : Number(cap);
  const pinBad = pinOn && !isValidPin(pin);
  const nameUsable = nameOn && !!holder && hidden.length > 0;

  const toggleChar = (i: number) => {
    host.haptics.select();
    setHidden((h) => {
      const next = h.includes(i) ? h.filter((x) => x !== i) : [...h, i].sort((a, b) => a - b);
      return next.length ? next : h; // keep at least one hidden
    });
  };

  const create = async () => {
    if (!manager || busy) return;
    if (pinBad) return setProblem({ text: s.pinInvalid });
    setBusy(true);
    setProblem(null);
    try {
      const share = await manager.start({
        ttlS: ttlSeconds(ttl),
        capYuan,
        pin: pinOn ? pin : null,
        name: nameUsable ? { full: holder!, hidden } : null,
      });
      host.haptics.success();
      setShareId(share.id);
    } catch (e) {
      host.haptics.warning();
      if (e instanceof NotDigitalError) setProblem({ text: s.notDigital(e.current), action: { label: s.openPay, href: '/m/wallet/pay' } });
      else if (isCloudError(e, 'consent_required')) setProblem({ text: s.consent });
      else if (isCloudError(e, 'not_configured')) setProblem({ text: s.noCloud });
      else setProblem({ text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetScreen title={s.createTitle} primary={busy ? s.creating : s.create} onPrimary={() => void create()} loading={busy} primaryDisabled={!manager || pinBad}>
      <View style={{ gap: t.spacing.xl }}>
        <Glass tone="regular" radius={t.radius.lg}>
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Icon name="shield" size={18} color={t.colors.warn} />
              <Text variant="bodyStrong">{s.disclaimerTitle}</Text>
            </View>
            <Text variant="caption" tone="muted">
              {s.disclaimer}
            </Text>
          </View>
        </Glass>

        <ListGroup title={s.ttl}>
          <View style={{ padding: t.spacing.md }}>
            <Segmented options={TTL_PRESETS.map((p) => ({ label: s.ttlLabel[p], value: p }))} value={ttl} onChange={(v) => setTtl(v as TtlPreset)} />
          </View>
        </ListGroup>

        <ListGroup title={s.cap} footer={s.capFooter}>
          <View style={{ padding: t.spacing.md }}>
            <Segmented options={[...CAP_PRESETS.map((n) => ({ label: s.capValue(n), value: String(n) })), { label: s.noCap, value: 'none' }]} value={cap} onChange={setCap} />
          </View>
        </ListGroup>

        <ListGroup title={s.gates} footer={s.gatesFooter}>
          <View style={{ padding: t.spacing.md, gap: t.spacing.md }}>
            <Switch label={s.nameGate} value={nameOn} onValueChange={setNameOn} />
            {nameOn ? (
              holder === undefined ? (
                <Skeleton width="60%" height={52} rounded={t.radius.md} />
              ) : holder ? (
                <View style={{ gap: t.spacing.sm }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
                    {nameChars(holder).map((c, i) => {
                      const off = hidden.includes(i);
                      return (
                        <Pressable key={i} onPress={() => toggleChar(i)} accessibilityRole="button" accessibilityLabel={off ? `${i + 1}: _` : `${i + 1}: ${c}`} scaleTo={0.94}>
                          <View
                            style={{
                              width: 48,
                              height: 56,
                              borderRadius: t.radius.md,
                              borderCurve: 'continuous',
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor: off ? t.colors.accentMuted : t.colors.surface2,
                              borderWidth: 1,
                              borderColor: off ? t.colors.accent : t.colors.border,
                            }}
                          >
                            <Text variant="title" tone={off ? 'accent' : 'default'}>
                              {off ? '_' : c}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text variant="caption" tone="muted">
                    {s.nameGateHint}
                  </Text>
                  <Text variant="callout">{s.namePreview(maskName(holder, hidden))}</Text>
                </View>
              ) : (
                <Text variant="caption" tone="warn">
                  {s.nameMissing}
                </Text>
              )
            ) : null}
            <Switch label={s.pinGate} value={pinOn} onValueChange={setPinOn} />
            {pinOn ? <Field label={s.pinField} value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" placeholder="••••" hint={s.pinHint} autoCapitalize="none" /> : null}
          </View>
        </ListGroup>

        {problem ? (
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="callout" tone="down">
              {problem.text}
            </Text>
            {problem.action ? <Button title={problem.action.label} variant="secondary" size="sm" icon="card" onPress={() => host.navigate(problem.action!.href)} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        ) : null}
      </View>
    </SheetScreen>
  );
}
