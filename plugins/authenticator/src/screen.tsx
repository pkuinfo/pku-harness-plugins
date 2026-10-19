import type { OtpStatus, PluginScreenProps } from '@pku-harness/sdk';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { CodeDigits, CopyArea, secondsLeft, useOtp } from './code';

/** What binding does, shown before the user can start it (see the plugin README in index.ts). */
const WARNINGS = [
  '绑定会在学校统一身份认证（IAAA）生成新的手机令牌密钥并交给本 App。之前在其他 App（如 FreeOTP、Google Authenticator 或学校推荐的令牌 App）绑定的手机令牌将不再有效。',
  '之后凡是要求手机令牌的登录（包括网页登录 iaaa.pku.edu.cn），都要输入这里显示的 6 位验证码；本 App 自己登录时会自动填写。',
  '密钥只保存在本机的系统安全存储里：不会上传，也不会交给 AI。卸载 App、清除数据或换手机会丢失密钥，届时可以用短信重新绑定。',
  '绑定时会用你保存的校园账号密码向 IAAA 验证身份，并给账号绑定的手机发一条短信验证码。',
];

/** Bind / show / remove the harness's 手机令牌. All steps are explicit button presses. */
export function AuthenticatorScreen({ host, services }: PluginScreenProps) {
  const { Screen, Text, Button, ListGroup, ListRow, Field, Checkbox, EmptyState, Glass, Hourglass, Pressable } = host.components;
  const t = host.useTheme();
  const now = host.useNow(1000);
  const { otp, refresh } = useOtp(services);
  const [status, setStatus] = useState<OtpStatus | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [sentTo, setSentTo] = useState<string | null | undefined>(undefined); // undefined = not sent
  const [sms, setSms] = useState('');
  const [busy, setBusy] = useState<'send' | 'bind' | 'remove' | null>(null);
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
      setNotice({ tone: 'muted', text: r.sentTo ? `验证码已发送到 ${r.sentTo}` : '验证码已发送到绑定手机' });
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
      setNotice({ tone: 'up', text: '绑定成功，本 App 现在就是你的手机令牌' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert('从本机移除手机令牌？', '学校那边的绑定不会解除：之后要求手机令牌的登录需要别处的令牌，或在这里用短信重新绑定。', [
      { text: '取消', style: 'cancel' },
      {
        text: '移除',
        style: 'destructive',
        onPress: () => {
          setBusy('remove');
          void services.campus
            .otpUnbindLocal()
            .then(reload)
            .then(() => setNotice({ tone: 'muted', text: '已从本机移除' }))
            .catch(fail)
            .finally(() => setBusy(null));
        },
      },
    ]);

  if (!signedIn)
    return (
      <Screen title="手机令牌" back>
        <EmptyState icon="person" title="先登录校园账号" message="绑定手机令牌需要用你的校园账号向学校验证身份。" action={<Button title="去登录" onPress={() => host.navigate('/campus')} />} />
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
      <Screen title="手机令牌" subtitle="IAAA 动态验证码" back>
        <View style={{ gap: t.spacing.xl }}>
          <Glass radius={t.radius.xl}>
            <View style={{ padding: t.spacing.xl, alignItems: 'center', gap: t.spacing.lg }}>
              <Hourglass period={30} size={72} tone={left <= 5 ? 'warn' : 'accent'} />
              <CopyArea host={host} code={otp?.code ?? null}>
                <View style={{ alignItems: 'center', gap: t.spacing.xs }}>{otp ? <CodeDigits host={host} code={otp.code} variant="numberXL" /> : <Text variant="numberXL">——</Text>}</View>
              </CopyArea>
              <Text variant="caption" tone={left <= 5 ? 'warn' : 'muted'}>
                {left} 秒后更新
              </Text>
            </View>
          </Glass>
          {noticeView}
          <ListGroup footer="本 App 登录学校系统、树洞课表和成绩的二次验证会自动使用这里的验证码。在别的设备登录时，打开这里看验证码即可。">
            <ListRow icon="person" title="账号" value={status.userName ? `${status.userName}（${status.userId ?? ''}）` : (status.userId ?? '')} />
            <ListRow icon="clock" title="绑定时间" value={status.boundAt ? host.formatAgo(status.boundAt) : '—'} />
          </ListGroup>
          <Button title="从本机移除" variant="danger" icon="trash" loading={busy === 'remove'} onPress={remove} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="手机令牌" subtitle="把本 App 绑定为 IAAA 手机令牌" back>
      <View style={{ gap: t.spacing.xl }}>
        <ListGroup title="绑定前请了解">
          {WARNINGS.map((w, i) => (
            <ListRow key={i} icon={i === 0 ? 'warning' : i === 2 ? 'shield' : 'key'} title={w} titleLines={6} />
          ))}
        </ListGroup>

        {sentTo === undefined ? (
          <View style={{ gap: t.spacing.md }}>
            {/* The host Checkbox's label is for accessibility only; the visible text toggles it too. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Checkbox value={agreed} onValueChange={setAgreed} label="我已了解，旧的手机令牌会失效" />
              <Pressable accessibilityRole="button" accessibilityLabel={agreed ? "取消勾选：我已了解" : "勾选：我已了解"} haptic={false} onPress={() => setAgreed((v) => !v)} style={{ flex: 1, paddingVertical: t.spacing.sm }}>
                <Text variant="body">我已了解，之前绑定的手机令牌会失效</Text>
              </Pressable>
            </View>
            <Button title="发送绑定验证码" icon="send" disabled={!agreed || status == null} loading={busy === 'send'} onPress={() => void send()} />
          </View>
        ) : (
          <View style={{ gap: t.spacing.md }}>
            <Field label="短信验证码" value={sms} onChangeText={setSms} placeholder="6 位数字" keyboardType="number-pad" autoFocus hint={sentTo ? `已发送到 ${sentTo}` : undefined} />
            <Button title="完成绑定" icon="check" disabled={!/^\d{4,8}$/.test(sms.trim())} loading={busy === 'bind'} onPress={() => void bind()} />
            <Button title="重新发送" variant="ghost" size="sm" loading={busy === 'send'} onPress={() => void send()} />
          </View>
        )}
        {noticeView}
      </View>
    </Screen>
  );
}
