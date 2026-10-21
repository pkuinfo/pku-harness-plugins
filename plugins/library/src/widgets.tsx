import type { LiveData, PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

type LoansData = { count: number; overdueCount: number; nextDueDate: string | null; nextDueInDays: number | null; nextDueTitle: string | null };
type SpaceRes = { uuid: string; kind: string; place: string; begin: string | null; end: string | null; status: string; canCancel: boolean };

function SignedOut({ host, what }: PluginWidgetProps & { what: string }) {
  const { Text, Button } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="caption" tone="muted">
        登录校园账号后显示{what}
      </Text>
      <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

function Loading({ host, size }: PluginWidgetProps) {
  const { Skeleton } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Skeleton width="60%" height={size === 'sm' ? 22 : 28} />
      <Skeleton width="40%" height={12} />
    </View>
  );
}

function Failed({ host, data }: PluginWidgetProps & { data: LiveData<unknown> }) {
  const { Text, Button } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="caption" tone="muted" numberOfLines={3}>
        {data.error ?? '没有数据'}
      </Text>
      <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

const dueText = (days: number | null) => (days == null ? '' : days < 0 ? `已超期 ${-days} 天` : days === 0 ? '今天到期' : `${days} 天后到期`);

/** 借阅到期: the soonest due loan, tinted when overdue or due within 3 days. */
export function DueWidget(props: PluginWidgetProps) {
  if (!props.services.campus.status().signedIn) return <SignedOut {...props} what="借阅到期" />;
  return <DueLive {...props} />;
}

function DueLive(props: PluginWidgetProps) {
  const { host, size } = props;
  const { Text, Chip, Button } = host.components;
  const t = host.useTheme();
  const data = host.useToolData<LoansData>('library.loans', {}, { ttlMinutes: 60 });
  if (data.status === 'loading') return <Loading {...props} />;
  if (!data.value) return <Failed {...props} data={data} />;
  const v = data.value;
  if (!v.count)
    return (
      <View style={{ gap: t.spacing.xs }}>
        <Text variant="micro" tone="faint">
          图书馆借阅
        </Text>
        <Text variant="bodyStrong">目前没有在借的书</Text>
      </View>
    );
  const days = v.nextDueInDays;
  const tone = days != null && days < 0 ? 'down' : days != null && days <= 3 ? 'warn' : 'default';
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="micro" tone="faint">
        借阅到期 · 在借 {v.count} 本
      </Text>
      <Text variant={size === 'sm' ? 'numberM' : 'numberL'} tone={tone}>
        {v.nextDueDate ? v.nextDueDate.slice(5) : '—'}
      </Text>
      <Text variant="caption" tone={tone === 'default' ? 'muted' : tone} numberOfLines={1}>
        {dueText(days)}
        {size !== 'sm' && v.nextDueTitle ? ` · ${v.nextDueTitle}` : ''}
      </Text>
      {size !== 'sm' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          {v.overdueCount ? <Chip label={`${v.overdueCount} 本超期`} tone="down" icon="warning" /> : <View />}
          <Button title="续借" size="sm" variant="secondary" onPress={() => host.ask('看看我借的书哪些能续借，列出来让我确认后续借')} />
        </View>
      ) : null}
    </View>
  );
}

/** 我的研讨室预约: the next active reservation (not ended, not cancelled). */
export function SpaceWidget(props: PluginWidgetProps) {
  if (!props.services.campus.status().signedIn) return <SignedOut {...props} what="空间预约" />;
  return <SpaceLive {...props} />;
}

function SpaceLive(props: PluginWidgetProps) {
  const { host, size } = props;
  const { Text, Chip, Button } = host.components;
  const t = host.useTheme();
  const now = host.useNow(60_000);
  const data = host.useToolData<SpaceRes[]>('library.spaceReservations', {}, { ttlMinutes: 15 });
  if (data.status === 'loading') return <Loading {...props} />;
  if (!data.value) return <Failed {...props} data={data} />;
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const next = data.value.find((r) => r.end && r.end > stamp && !/已结束|违约|未通过/.test(r.status));
  if (!next)
    return (
      <View style={{ gap: t.spacing.xs }}>
        <Text variant="micro" tone="faint">
          图书馆空间预约
        </Text>
        <Text variant="bodyStrong">暂无预约</Text>
        {size !== 'sm' ? <Button title="约研讨室" size="sm" variant="secondary" onPress={() => host.ask('帮我看看图书馆研讨室今天和明天哪些时段空着')} style={{ alignSelf: 'flex-start' }} /> : null}
      </View>
    );
  const started = !!next.begin && next.begin <= stamp;
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="micro" tone="faint">
        {next.kind}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1}>
        {next.place}
      </Text>
      <Text variant="caption" tone="muted">
        {next.begin ? next.begin.slice(5) : ''}
        {next.end ? ` – ${next.end.slice(next.begin?.slice(0, 10) === next.end.slice(0, 10) ? 11 : 5)}` : ''}
      </Text>
      {size !== 'sm' ? <Chip label={started ? `${next.status} · 记得签到` : next.status} tone={started ? 'warn' : 'info'} icon="clock" /> : null}
    </View>
  );
}
