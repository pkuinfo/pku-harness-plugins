import { formatRelative, type PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { strings } from './strings';

type Result = { status: 'synced'; count: number } | { status: 'verification_required'; kind: 'login' | 'course'; methods: ('sms' | 'otp')[]; message: string };

/** Sync button, plus the code step when treehole asks for one; same tools as the agent. */
export function CourseSyncScreen({ host, services, kv, invoke }: PluginScreenProps) {
  const { Screen, Text, Button, ListGroup, ListRow, Field, Segmented, EmptyState } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  host.useStoreVersion();
  const [last, setLast] = useState<{ at: number; count: number } | null>(null);
  const [step, setStep] = useState<Extract<Result, { status: 'verification_required' }> | null>(null);
  const [method, setMethod] = useState<'sms' | 'otp'>('otp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'sync' | 'send' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'up' | 'down' | 'muted'; text: string } | null>(null);
  const campusCount = services.timetable.get().courses.filter((c) => c.source === 'campus').length;

  useEffect(() => {
    void kv.get<{ at: number; count: number }>('lastSync').then((v) => setLast(v ?? null));
  }, [kv]);

  const run = async (input: Record<string, unknown>) => {
    setBusy('sync');
    setNotice(null);
    try {
      const r = (await invoke('course-sync.sync', input)) as Result;
      if (r.status === 'synced') {
        host.haptics.success();
        setStep(null);
        setCode('');
        setLast({ at: Date.now(), count: r.count });
        setNotice({ tone: 'up', text: s.synced(r.count) });
      } else {
        setStep(r);
        setMethod(r.methods.includes('otp') ? 'otp' : 'sms');
      }
    } catch (e) {
      host.haptics.warning();
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy('send');
    try {
      const r = (await invoke('course-sync.sendCode')) as { sent: string };
      setNotice({ tone: 'muted', text: s.sentText(r.sent) });
    } catch (e) {
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!services.campus.status().signedIn)
    return (
      <Screen title={s.title} back>
        <EmptyState icon="person" title={s.signInFirst} message={s.signInWhy} action={<Button title={s.goSignIn} onPress={() => host.navigate('/campus')} />} />
      </Screen>
    );

  return (
    <Screen title={s.title} subtitle={s.subtitle} back>
      <View style={{ gap: t.spacing.xl }}>
        <ListGroup footer={s.footer}>
          <ListRow icon="book" title={s.syncedClasses} value={s.classes(campusCount)} />
          <ListRow icon="clock" title={s.lastSync} value={last ? formatRelative(last.at, locale) : s.never} />
        </ListGroup>

        {step ? (
          <View style={{ gap: t.spacing.md }}>
            <Text variant="headline">{s.verifyNeeded}</Text>
            <Text variant="callout" tone="muted">
              {step.message}
            </Text>
            {step.methods.length > 1 ? (
              <Segmented
                options={[
                  { label: s.otp, value: 'otp' },
                  { label: s.sms, value: 'sms' },
                ]}
                value={method}
                onChange={(v) => setMethod(v as 'sms' | 'otp')}
              />
            ) : null}
            {method === 'sms' ? <Button title={s.sendSms} variant="secondary" icon="send" loading={busy === 'send'} onPress={() => void send()} /> : null}
            <Field label={method === 'otp' ? s.otpCode : s.smsCode} value={code} onChangeText={setCode} placeholder={s.codePlaceholder} keyboardType="number-pad" autoCapitalize="none" />
            <Button title={s.verifyAndSync} icon="refresh" loading={busy === 'sync'} disabled={code.trim().length < 4} onPress={() => void run({ code: code.trim(), method })} />
          </View>
        ) : (
          <Button title={campusCount ? s.resync : s.sync} icon="refresh" size="lg" loading={busy === 'sync'} onPress={() => void run({})} />
        )}

        {notice ? (
          <Text variant="callout" tone={notice.tone} align="center">
            {notice.text}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
