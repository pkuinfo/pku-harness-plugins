import { formatRelative, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

type Item = { title: string; course: string; deadline: number | null; submitted: boolean; contentId: string };

/** Unsubmitted assignments by deadline; crawling is slow, so the data stays fresh for 2 hours. */
export function DueWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {s.signedOut}
        </Text>
        <Button title={s.signIn} size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(60_000).getTime();
  const data = host.useToolData<Item[]>('courses.assignments', {}, { ttlMinutes: 120 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="80%" height={16} />
        <Skeleton width="60%" height={16} />
      </View>
    );
  if (!data.value)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {data.error ?? s.noData}
        </Text>
        <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  const due = data.value.filter((a) => !a.submitted).slice(0, size === 'lg' ? 6 : 3);
  if (!due.length)
    return (
      <Text variant="callout" tone="up">
        {s.nothingDue}
      </Text>
    );
  return (
    <View style={{ gap: t.spacing.md }}>
      {due.map((a) => {
        const urgent = a.deadline != null && a.deadline - now < 24 * 3600_000;
        return (
          <View key={a.contentId} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <View style={{ flex: 1, gap: t.spacing.xxs }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {a.title}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {a.course}
              </Text>
            </View>
            <Text variant="callout" tone={urgent ? 'down' : 'muted'}>
              {a.deadline == null ? s.noDeadline : s.timeLeft(a.deadline - now)}
            </Text>
          </View>
        );
      })}
      <Text variant="micro" tone={data.error ? 'warn' : 'faint'}>
        {data.fetching ? s.refreshing : `${data.error ? s.refreshFailed : ''}${data.updatedAt ? formatRelative(data.updatedAt, locale, now) : ''}`}
      </Text>
    </View>
  );
}
