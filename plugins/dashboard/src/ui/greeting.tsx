import { classesOn, classStatus, formatLocalDate, formatWeekday, weekOf, type HostServices, type HostUI } from '@pku-harness/sdk';
import { View } from 'react-native';

import { strings } from './strings';

/** The dashboard's opening line: who you are, what day it is, what's next. */
export function Greeting({ host, services }: { host: HostUI; services: HostServices }) {
  const { Text, FadeIn } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  host.useStoreVersion();
  const now = host.useNow(60_000);
  const campus = services.campus.status();
  const { courses, semester } = services.timetable.get();
  const week = weekOf(semester, now);
  const today = classesOn(courses, now, semester).map((c) => ({ c, s: classStatus(c, now) }));
  const current = today.find((x) => x.s.state === 'ongoing');
  const next = today.find((x) => x.s.state === 'before');
  const left = today.filter((x) => x.s.state !== 'after').length;

  const who = campus.name ?? (campus.signedIn ? s.student : '');
  const date = locale === 'en' ? `${formatWeekday(now, locale)}, ${formatLocalDate(now, locale, now)}` : `${formatLocalDate(now, locale, now)} ${formatWeekday(now, locale)}`;
  const day = `${date}${week ? s.week(week) : ''}`;
  const line = current
    ? `${s.inClass(current.c.name)}${current.c.location ? ` · ${current.c.location}` : ''}`
    : next
      ? `${s.nextClass(next.c.name)}${next.s.minutesToStart <= 90 ? ` · ${s.inMinutes(next.s.minutesToStart)}` : ` · ${next.c.start}`}${next.c.location ? ` · ${next.c.location}` : ''}`
      : today.length
        ? s.allDone
        : courses.length
          ? s.noClasses
          : campus.signedIn
            ? s.signedInHint
            : s.signedOutHint;
  const greeting = s.greeting(now.getHours());

  return (
    <FadeIn>
      <View style={{ gap: t.spacing.xs, paddingBottom: t.spacing.xs }}>
        <Text variant="micro" tone="faint">
          {day}
        </Text>
        <Text variant="title" numberOfLines={1}>
          {who ? s.withName(greeting, who) : greeting}
        </Text>
        <Text variant="callout" tone={current ? 'accent' : 'muted'} numberOfLines={2}>
          {line}
          {left > 1 && !current ? s.left(left) : ''}
        </Text>
      </View>
    </FadeIn>
  );
}
