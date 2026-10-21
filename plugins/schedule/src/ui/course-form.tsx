import { formatTime, formatWeeks, parseWeeks, type PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { strings } from './strings';

const toDate = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};
const toTime = (d: Date) => formatTime(d.getHours(), d.getMinutes());

/** Add or edit a course meeting. Saves through the timetable tools, like the agent does. */
export function CourseForm({ host, services, invoke, params }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, WeekdayPicker, Text } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const id = params.id ?? 'new';
  const existing = id === 'new' ? undefined : services.timetable.get().courses.find((c) => c.id === id);
  const [name, setName] = useState(existing?.name ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [teacher, setTeacher] = useState(existing?.teacher ?? '');
  const [weekday, setWeekday] = useState(existing?.weekday ?? (new Date().getDay() || 1));
  const [start, setStart] = useState(() => toDate(existing?.start ?? '08:00'));
  const [end, setEnd] = useState(() => toDate(existing?.end ?? '09:50'));
  const [weeks, setWeeks] = useState(existing?.weeks ? formatWeeks(existing.weeks, locale).replace(/周$/, '').replace(/^Weeks? /, '') : '');
  const [error, setError] = useState<string | null>(null);

  let weeksError: string | null = null;
  try {
    parseWeeks(weeks);
  } catch {
    weeksError = s.weeksFormat;
  }
  const timeError = toTime(end) <= toTime(start) ? s.endAfterStart : null;

  const save = async () => {
    const input = { name: name.trim(), weekday, start: toTime(start), end: toTime(end), location: location.trim(), teacher: teacher.trim() };
    try {
      if (existing) await invoke('timetable.updateCourse', { id: existing.id, ...input, weeks: weeks.trim() });
      else await invoke('timetable.addCourse', { ...input, weeks: weeks.trim() || undefined });
      host.haptics.success();
      host.dismiss('/schedule');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      host.haptics.warning();
    }
  };

  return (
    <SheetScreen
      title={existing ? s.editCourse : s.addClass}
      primary={s.save}
      onPrimary={save}
      primaryDisabled={!name.trim() || !!weeksError || !!timeError}
      danger={existing ? s.delete : undefined}
      onDanger={async () => {
        host.haptics.warning();
        if (existing) await invoke('timetable.removeCourse', { id: existing.id });
        host.dismiss('/schedule');
      }}>
      <Field label={s.courseName} value={name} onChangeText={setName} placeholder={s.courseNamePlaceholder} autoFocus={!existing} />
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          {s.weekday}
        </Text>
        <WeekdayPicker value={[weekday]} onChange={([d]) => setWeekday(d)} />
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <View style={{ flex: 1 }}>
          <DateTimeField label={s.starts} value={start} onChange={setStart} mode="time" />
        </View>
        <View style={{ flex: 1 }}>
          <DateTimeField label={s.ends_} value={end} onChange={setEnd} mode="time" />
        </View>
      </View>
      {timeError ? (
        <Text variant="caption" tone="warn">
          {timeError}
        </Text>
      ) : null}
      <Field label={s.location} value={location} onChangeText={setLocation} placeholder={s.locationPlaceholder} />
      <Field label={s.teacher} value={teacher} onChangeText={setTeacher} placeholder={s.optional} />
      <Field label={s.weeks} value={weeks} onChangeText={setWeeks} placeholder={s.weeksPlaceholder} hint={weeksError ?? s.weeksHint} />
      {error ? (
        <Text variant="caption" tone="down">
          {error}
        </Text>
      ) : null}
    </SheetScreen>
  );
}
