import type { LiveData, PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type LoansData = { count: number; overdueCount: number; nextDueDate: string | null; nextDueInDays: number | null; nextDueTitle: string | null };
type SpaceRes = { uuid: string; kind: string; place: string; begin: string | null; end: string | null; status: string; canCancel: boolean };

function SignedOut({ host, what }: PluginWidgetProps & { what: 'signedOutLoans' | 'signedOutSpace' }) {
  const { Text, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="caption" tone="muted">
        {s[what]}
      </Text>
      <Button title={s.signIn} size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
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
  const s = strings[host.useLocale()];
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="caption" tone="muted" numberOfLines={3}>
        {data.error ?? s.noData}
      </Text>
      <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
    </View>
  );
}

/** 借阅到期: the soonest due loan, tinted when overdue or due within 3 days. */
export function DueWidget(props: PluginWidgetProps) {
  if (!props.services.campus.status().signedIn) return <SignedOut {...props} what="signedOutLoans" />;
  return <DueLive {...props} />;
}

function DueLive(props: PluginWidgetProps) {
  const { host, size } = props;
  const { Text, Chip, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const data = host.useToolData<LoansData>('library.loans', {}, { ttlMinutes: 60 });
  if (data.status === 'loading') return <Loading {...props} />;
  if (!data.value) return <Failed {...props} data={data} />;
  const v = data.value;
  if (!v.count)
    return (
      <View style={{ gap: t.spacing.xs }}>
        <Text variant="micro" tone="faint">
          {s.loansLabel}
        </Text>
        <Text variant="bodyStrong">{s.noLoans}</Text>
      </View>
    );
  const days = v.nextDueInDays;
  const tone = days != null && days < 0 ? 'down' : days != null && days <= 3 ? 'warn' : 'default';
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="micro" tone="faint">
        {s.dueLabel(v.count)}
      </Text>
      <Text variant={size === 'sm' ? 'numberM' : 'numberL'} tone={tone}>
        {v.nextDueDate ? v.nextDueDate.slice(5) : '—'}
      </Text>
      <Text variant="caption" tone={tone === 'default' ? 'muted' : tone} numberOfLines={1}>
        {s.due(days)}
        {size !== 'sm' && v.nextDueTitle ? ` · ${v.nextDueTitle}` : ''}
      </Text>
      {size !== 'sm' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          {v.overdueCount ? <Chip label={s.overdue(v.overdueCount)} tone="down" icon="warning" /> : <View />}
          <Button title={s.renew} size="sm" variant="secondary" onPress={() => host.ask(s.askRenew)} />
        </View>
      ) : null}
    </View>
  );
}

/** 我的研讨室预约: the next active reservation (not ended, not cancelled). */
export function SpaceWidget(props: PluginWidgetProps) {
  if (!props.services.campus.status().signedIn) return <SignedOut {...props} what="signedOutSpace" />;
  return <SpaceLive {...props} />;
}

function SpaceLive(props: PluginWidgetProps) {
  const { host, size } = props;
  const { Text, Chip, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
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
          {s.spaceLabel}
        </Text>
        <Text variant="bodyStrong">{s.noBookings}</Text>
        {size !== 'sm' ? <Button title={s.bookRoom} size="sm" variant="secondary" onPress={() => host.ask(s.askRooms)} style={{ alignSelf: 'flex-start' }} /> : null}
      </View>
    );
  const started = !!next.begin && next.begin <= stamp;
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text variant="micro" tone="faint">
        {s.kind(next.kind)}
      </Text>
      <Text variant="bodyStrong" numberOfLines={1}>
        {next.place}
      </Text>
      <Text variant="caption" tone="muted">
        {next.begin ? next.begin.slice(5) : ''}
        {next.end ? ` – ${next.end.slice(next.begin?.slice(0, 10) === next.end.slice(0, 10) ? 11 : 5)}` : ''}
      </Text>
      {size !== 'sm' ? <Chip label={started ? s.checkIn(s.status(next.status)) : s.status(next.status)} tone={started ? 'warn' : 'info'} icon="clock" /> : null}
    </View>
  );
}
