import type { PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

type Result = { status: 'synced'; count: number } | { status: 'verification_required'; kind: 'login' | 'course'; methods: ('sms' | 'otp')[]; message: string };

/** Sync button, plus the code step when treehole asks for one; same tools as the agent. */
export function CourseSyncScreen({ host, services, kv, invoke }: PluginScreenProps) {
  const { Screen, Text, Button, ListGroup, ListRow, Field, Segmented, EmptyState } = host.components;
  const t = host.useTheme();
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
        setNotice({ tone: 'up', text: `已同步 ${r.count} 节课到日程` });
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
      setNotice({ tone: 'muted', text: r.sent });
    } catch (e) {
      setNotice({ tone: 'down', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  if (!services.campus.status().signedIn)
    return (
      <Screen title="教务课表" back>
        <EmptyState icon="person" title="先登录校园账号" message="课表来自学校系统，需要用你的校园账号登录。" action={<Button title="去登录" onPress={() => host.navigate('/campus')} />} />
      </Screen>
    );

  return (
    <Screen title="教务课表" subtitle="来自树洞课表" back>
      <View style={{ gap: t.spacing.xl }}>
        <ListGroup footer="同步会替换之前同步的课，你手动添加的课不受影响。">
          <ListRow icon="book" title="已同步的课" value={`${campusCount} 节`} />
          <ListRow icon="clock" title="上次同步" value={last ? host.formatAgo(last.at) : '从未'} />
        </ListGroup>

        {step ? (
          <View style={{ gap: t.spacing.md }}>
            <Text variant="headline">需要验证</Text>
            <Text variant="callout" tone="muted">
              {step.message}
            </Text>
            {step.methods.length > 1 ? (
              <Segmented
                options={[
                  { label: '手机令牌', value: 'otp' },
                  { label: '短信', value: 'sms' },
                ]}
                value={method}
                onChange={(v) => setMethod(v as 'sms' | 'otp')}
              />
            ) : null}
            {method === 'sms' ? <Button title="发送短信验证码" variant="secondary" icon="send" loading={busy === 'send'} onPress={() => void send()} /> : null}
            <Field label={method === 'otp' ? '手机令牌验证码' : '短信验证码'} value={code} onChangeText={setCode} placeholder="6 位数字" keyboardType="number-pad" autoCapitalize="none" />
            <Button title="验证并同步" icon="refresh" loading={busy === 'sync'} disabled={code.trim().length < 4} onPress={() => void run({ code: code.trim(), method })} />
          </View>
        ) : (
          <Button title={campusCount ? '重新同步' : '同步课表'} icon="refresh" size="lg" loading={busy === 'sync'} onPress={() => void run({})} />
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
