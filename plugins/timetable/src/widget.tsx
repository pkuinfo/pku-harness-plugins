import { classesOn, classStatus, weekOf, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

/** The ongoing or next class today (local data, so it updates with the clock, no fetching). */
export function NextClassWidget({ host, services, size }: PluginWidgetProps) {
  const { Text, Button } = host.components;
  const t = host.useTheme();
  const str = strings[host.useLocale()];
  host.useStoreVersion();
  const now = host.useNow(30_000);
  const { courses, semester } = services.timetable.get();
  const week = weekOf(semester, now);
  const today = classesOn(courses, now, semester);
  const rows = today.map((c) => ({ c, s: classStatus(c, now) }));
  const current = rows.find((r) => r.s.state === 'ongoing') ?? rows.find((r) => r.s.state === 'before');
  const left = rows.filter((r) => r.s.state === 'before').length;

  if (!courses.length)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {str.empty}
        </Text>
        <Button title={str.addClass} size="sm" variant="secondary" icon="plus" onPress={() => host.navigate('/schedule')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  if (!current)
    return (
      <View style={{ gap: t.spacing.xxs }}>
        <Text variant={size === 'sm' ? 'bodyStrong' : 'headline'}>{today.length ? str.doneToday : str.noneToday}</Text>
        <Text variant="caption" tone="muted">
          {week ? str.week(week) : ''}
          {today.length ? str.total(today.length) : str.rest}
        </Text>
      </View>
    );

  const { c, s } = current;
  const color = t.courseColor(c.color);
  const label = s.state === 'ongoing' ? str.inClass : s.minutesToStart <= 60 ? str.inMinutes(s.minutesToStart) : str.startsAt(c.start);
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
      <View style={{ width: 4, borderRadius: t.radius.full, backgroundColor: color.ink }} />
      <View style={{ flex: 1, gap: t.spacing.xxs }}>
        <Text variant="micro" tone={s.state === 'ongoing' ? 'accent' : 'faint'}>
          {label}
        </Text>
        <Text variant={size === 'sm' ? 'bodyStrong' : 'headline'} numberOfLines={size === 'sm' ? 2 : 1}>
          {c.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {c.start}–{c.end}
          {c.location ? ` · ${c.location}` : ''}
        </Text>
        {size !== 'sm' ? (
          <View style={{ gap: t.spacing.xs, marginTop: t.spacing.xs }}>
            {s.state === 'ongoing' ? (
              <View style={{ height: 4, borderRadius: t.radius.full, backgroundColor: t.colors.surface3, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round(s.progress * 100)}%`, height: 4, backgroundColor: color.ink }} />
              </View>
            ) : null}
            <Text variant="micro" tone="faint">
              {week ? str.week(week) : ''}
              {left > 0 ? str.left(left) : str.last}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
