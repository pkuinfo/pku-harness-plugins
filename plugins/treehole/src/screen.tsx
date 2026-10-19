import type { HostUI, PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';

type Quote = { name: string; text: string };
type HoleOut = { pid: number; text: string; time: string; replies: number; likes: number; followed: boolean; pinned?: boolean; tags?: string[]; images?: number };
type CommentOut = { cid: number; name: string; text: string; time: string; replyTo?: Quote; images?: number };
type Verify = { status: 'verification_required'; message: string };
type Feed = { status: 'ok'; holes: (HoleOut & { comments: CommentOut[] })[] } | Verify;
type Detail = { status: 'ok'; hole: HoleOut; totalComments: number; comments: CommentOut[]; truncated?: boolean } | Verify;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** SMS step shared by both screens: send the code, then rerun `retry` with it. */
function VerifyPanel({ host, message, invoke, retry }: { host: HostUI; message: string; invoke: PluginScreenProps['invoke']; retry: (code: string) => Promise<void> }) {
  const { Text, Button, Field } = host.components;
  const t = host.useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'verify' | null>(null);
  const [notice, setNotice] = useState<{ tone: 'muted' | 'down'; text: string } | null>(null);
  const act = async (kind: 'send' | 'verify') => {
    setBusy(kind);
    try {
      if (kind === 'send') setNotice({ tone: 'muted', text: ((await invoke('treehole.sendCode')) as { sent: string }).sent });
      else {
        await retry(code.trim());
        host.haptics.success();
      }
    } catch (e) {
      host.haptics.warning();
      setNotice({ tone: 'down', text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={{ gap: t.spacing.md }}>
      <Text variant="headline">需要短信验证</Text>
      <Text variant="callout" tone="muted">
        {message.split('。')[0]}
      </Text>
      <Button title="发送短信验证码" variant="secondary" icon="send" loading={busy === 'send'} onPress={() => void act('send')} />
      <Field label="短信验证码" value={code} onChangeText={setCode} placeholder="6 位数字" keyboardType="number-pad" autoCapitalize="none" />
      <Button title="验证" icon="check" loading={busy === 'verify'} disabled={code.trim().length < 4} onPress={() => void act('verify')} />
      {notice ? (
        <Text variant="callout" tone={notice.tone} align="center">
          {notice.text}
        </Text>
      ) : null}
    </View>
  );
}

function SignIn({ host, title }: { host: HostUI; title: string }) {
  const { Screen, Button, EmptyState } = host.components;
  return (
    <Screen title={title} back>
      <EmptyState icon="person" title="先登录校园账号" message="树洞需要用你的校园账号登录。" action={<Button title="去登录" onPress={() => host.navigate('/campus')} />} />
    </Screen>
  );
}

/** Latest holes; tap one for the thread. Same tools as the agent. */
export function TreeholeScreen(props: PluginScreenProps) {
  if (!props.services.campus.status().signedIn) return <SignIn host={props.host} title="树洞" />;
  return <Latest {...props} />;
}

function Latest({ host, invoke }: PluginScreenProps) {
  const { Screen, Text, Skeleton, Glass, EmptyState, Button } = host.components;
  const t = host.useTheme();
  const data = host.useToolData<Feed>('treehole.latest', { limit: 20 }, { ttlMinutes: 5 });
  const v = data.value;
  return (
    <Screen title="树洞" subtitle="最新" back refreshControl={<RefreshControl refreshing={data.fetching} onRefresh={() => void data.refresh()} />}>
      <View style={{ gap: t.spacing.md }}>
        {!v && data.status === 'loading' ? (
          [0, 1, 2].map((i) => <Skeleton key={i} width="100%" height={72} />)
        ) : !v ? (
          <EmptyState icon="warning" title="加载失败" message={data.error} action={<Button title="重试" icon="refresh" onPress={() => void data.refresh()} />} />
        ) : v.status === 'verification_required' ? (
          <VerifyPanel
            host={host}
            message={v.message}
            invoke={invoke}
            retry={async (code) => {
              await invoke('treehole.latest', { limit: 20, code });
              await data.refresh();
            }}
          />
        ) : (
          v.holes.map((h) => (
            <Glass key={h.pid} onPress={() => host.navigate(`/p/treehole/hole?pid=${h.pid}`)} accessibilityLabel={`树洞 ${h.pid}`} accessibilityRole="button">
              <View style={{ padding: t.spacing.lg, gap: t.spacing.xs }}>
                <Text variant="caption" tone="faint">
                  #{h.pid} · {h.time.slice(5)} · {h.replies} 回复{h.images ? ` · ${h.images} 图` : ''}
                </Text>
                <Text variant="body" numberOfLines={5}>
                  {h.text}
                </Text>
              </View>
            </Glass>
          ))
        )}
        {data.error && v ? (
          <Text variant="micro" tone="warn" align="center">
            刷新失败：{data.error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

/** One hole with its comments; follow toggle. Opened at /p/treehole/hole?pid=… */
export function HoleScreen(props: PluginScreenProps) {
  if (!props.services.campus.status().signedIn) return <SignIn host={props.host} title="树洞帖子" />;
  return <Thread {...props} />;
}

function Thread({ host, invoke, params }: PluginScreenProps) {
  const { Screen, Text, Skeleton, Surface, EmptyState, Button } = host.components;
  const t = host.useTheme();
  const pid = Number(params.pid);
  const data = host.useToolData<Detail>('treehole.read', { pid }, { ttlMinutes: 2 });
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const v = data.value;
  if (!Number.isInteger(pid) || pid <= 0)
    return (
      <Screen title="树洞帖子" back>
        <EmptyState icon="warning" title="没有这个帖子" />
      </Screen>
    );
  const followed = following ?? (v?.status === 'ok' ? v.hole.followed : false);
  const toggle = async () => {
    setBusy(true);
    try {
      await invoke(followed ? 'treehole.unfollow' : 'treehole.follow', { pid });
      host.haptics.select();
      setFollowing(!followed);
    } catch {
      host.haptics.warning();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      title={`#${pid}`}
      back
      trailing={v?.status === 'ok' ? <Button title={followed ? '已关注' : '关注'} size="sm" variant={followed ? 'secondary' : 'primary'} loading={busy} onPress={() => void toggle()} /> : undefined}
      refreshControl={<RefreshControl refreshing={data.fetching} onRefresh={() => void data.refresh()} />}
    >
      <View style={{ gap: t.spacing.md }}>
        {!v && data.status === 'loading' ? (
          <Skeleton width="100%" height={120} />
        ) : !v ? (
          <EmptyState icon="warning" title="加载失败" message={data.error} action={<Button title="重试" icon="refresh" onPress={() => void data.refresh()} />} />
        ) : v.status === 'verification_required' ? (
          <VerifyPanel
            host={host}
            message={v.message}
            invoke={invoke}
            retry={async (code) => {
              await invoke('treehole.read', { pid, code });
              await data.refresh();
            }}
          />
        ) : (
          <>
            <Surface padded>
              <View style={{ gap: t.spacing.sm }}>
                <Text variant="caption" tone="faint">
                  {v.hole.time} · {v.hole.likes} 赞 · {v.totalComments} 回复{v.hole.images ? ` · ${v.hole.images} 图（请在树洞查看）` : ''}
                </Text>
                <Text variant="body" selectable>
                  {v.hole.text}
                </Text>
              </View>
            </Surface>
            {v.comments.map((c) => (
              <View key={c.cid} style={{ gap: t.spacing.xxs, paddingHorizontal: t.spacing.xs }}>
                <Text variant="caption" tone="muted">
                  {c.name} · {c.time.slice(5)}
                </Text>
                {c.replyTo ? (
                  <Text variant="caption" tone="faint" numberOfLines={2}>
                    Re {c.replyTo.name}：{c.replyTo.text}
                  </Text>
                ) : null}
                <Text variant="body" selectable>
                  {c.text}
                </Text>
              </View>
            ))}
            {v.truncated ? (
              <Text variant="micro" tone="faint" align="center">
                只显示前 {v.comments.length} 条回复
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
