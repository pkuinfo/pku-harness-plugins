import { formatRelative, type OtpStatus, type PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { CodeDigits, CopyArea, secondsLeft, useOtp } from './code';
import { strings } from './strings';

/** Bind / show / remove the harness's 手机令牌. All steps are explicit button presses. */
export function AuthenticatorScreen({ host, services }: PluginScreenProps) {
  const { Screen, Text, Button, ListGroup, ListRow, Field, Checkbox, EmptyState, Glass, Hourglass, Pressable, FadeIn, Chip } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(1000);
  const { otp, refresh } = useOtp(services);
  const [status, setStatus] = useState<OtpStatus | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null | undefined>(undefined); // undefined = not sent
  const [sms, setSms] = useState('');
  const [busy, setBusy] = useState<'send' | 'bind' | 'remove' | null>(null);
  /** Set on a successful bind so the bound view arrives as a moment, not a silent swap. */
  const [justBound, setJustBound] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'up' | 'down' | 'muted'; text: string } | null>(null);
  const signedIn = services.campus.status().signedIn;

  const reload = useCallback(async () => {
    setStatus(await services.campus.otpStatus());
    refresh();
  }, [services, refresh]);
  useEffect(() => {
    let alive = true;
    void services.campus.otpStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [services]);

  const fail = (e: unknown) => {
    host.haptics.warning();
    setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
  };

  const send = async () => {
    setBusy('send');
    setNotice(null);
    try {
      const r = await services.campus.otpBindStart();
      setSentTo(r.sentTo);
      setNotice({ tone: 'muted', text: r.sentTo ? s.sentTo(r.sentTo) : s.sentToPhone });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const bind = async () => {
    setBusy('bind');
    setNotice(null);
    try {
      setStatus(await services.campus.otpBindFinish(sms));
      refresh();
      host.haptics.success();
      setSentTo(undefined);
      setSms('');
      setAgreed(false);
      setJustBound(true);
      setNotice({ tone: 'up', text: s.boundNotice });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert(s.removeTitle, s.removeBody, [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.remove,
        style: 'destructive',
        onPress: () => {
          setBusy('remove');
          void services.campus
            .otpUnbindLocal()
            .then(reload)
            .then(() => setNotice({ tone: 'muted', text: s.removed }))
            .catch(fail)
            .finally(() => setBusy(null));
        },
      },
    ]);

  if (!signedIn)
    return (
      <Screen title={s.title} back>
        <EmptyState icon="person" title={s.signInFirst} message={s.signInWhy} action={<Button title={s.goSignIn} onPress={() => host.navigate('/campus')} />} />
      </Screen>
    );

  const noticeView = notice ? (
    <Text variant="callout" tone={notice.tone}>
      {notice.text}
    </Text>
  ) : null;

  if (status?.bound) {
    const left = secondsLeft(now.getTime());
    return (
      <Screen title={s.title} subtitle={s.boundSubtitle} back>
        <View style={{ gap: t.spacing.xl }}>
          <FadeIn key={justBound ? 'bound-now' : 'bound'}>
            <Glass radius={t.radius.xl}>
              <View style={{ padding: t.spacing.xl, alignItems: 'center', gap: t.spacing.lg }}>
                {justBound ? <Chip label={s.bound} tone="up" icon="check" /> : null}
                <Hourglass period={30} size={72} tone={left <= 5 ? 'warn' : 'accent'} />
                <CopyArea host={host} code={otp?.code ?? null}>
                  <View style={{ alignItems: 'center', gap: t.spacing.xs }}>{otp ? <CodeDigits host={host} code={otp.code} variant="numberXL" /> : <Text variant="numberXL">——</Text>}</View>
                </CopyArea>
                <Text variant="caption" tone={left <= 5 ? 'warn' : 'muted'}>
                  {s.updatesIn(left)}
                </Text>
              </View>
            </Glass>
          </FadeIn>
          {noticeView}
          <ListGroup footer={s.boundFooter}>
            <ListRow icon="person" title={s.account} value={status.userName ? (locale === 'en' ? `${status.userName} (${status.userId ?? ''})` : `${status.userName}（${status.userId ?? ''}）`) : (status.userId ?? '')} />
            <ListRow icon="clock" title={s.boundAt} value={status.boundAt ? formatRelative(status.boundAt, locale) : '—'} />
          </ListGroup>
          <Button title={s.removeLocal} variant="danger" icon="trash" loading={busy === 'remove'} onPress={remove} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={s.title} subtitle={s.bindSubtitle} back>
      <View style={{ gap: t.spacing.xl }}>
        <ListGroup title={s.beforeBinding}>
          {s.warnings.map((w, i) => (
            <ListRow key={i} icon={i === 0 ? 'warning' : i === 2 ? 'shield' : 'key'} title={w} titleLines={6} />
          ))}
        </ListGroup>

        {sentTo === undefined ? (
          <View style={{ gap: t.spacing.md }}>
            {/* The host Checkbox's label is for accessibility only; the visible text toggles it too. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Checkbox value={agreed} onValueChange={setAgreed} label={s.agreeA11y} />
              <Pressable accessibilityRole="button" accessibilityLabel={agreed ? s.agreeToggleOn : s.agreeToggleOff} haptic={false} onPress={() => setAgreed((v) => !v)} style={{ flex: 1, paddingVertical: t.spacing.sm }}>
                <Text variant="body">{s.agree}</Text>
              </Pressable>
            </View>
            <Button title={s.sendCode} icon="send" disabled={!agreed || status == null} loading={busy === 'send'} onPress={() => void send()} />
          </View>
        ) : (
          <View style={{ gap: t.spacing.md }}>
            <Field label={s.smsCode} value={sms} onChangeText={setSms} placeholder={s.smsPlaceholder} keyboardType="number-pad" autoFocus hint={sentTo ? s.smsSentTo(sentTo) : undefined} />
            <Button title={s.finish} icon="check" disabled={!/^\d{4,8}$/.test(sms.trim())} loading={busy === 'bind'} onPress={() => void bind()} />
            <Button title={s.resend} variant="ghost" size="sm" loading={busy === 'send'} onPress={() => void send()} />
          </View>
        )}
        {noticeView}
      </View>
    </Screen>
  );
}
