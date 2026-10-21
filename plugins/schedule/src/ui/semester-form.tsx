import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { strings } from './strings';

const pad = (n: number) => String(n).padStart(2, '0');

/** Semester dates for teaching weeks and class reminders (calendar.setSemester). */
export function SemesterForm({ host, services, invoke }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, Stepper, Text } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const cur = services.timetable.get().semester;
  const [name, setName] = useState(cur?.name ?? '');
  const [start, setStart] = useState<Date | null>(() => (cur ? new Date(`${cur.start}T00:00:00`) : null));
  const [weeks, setWeeks] = useState(cur?.weeks ?? 16);

  const save = async () => {
    if (!start) return;
    await invoke('calendar.setSemester', { name: name.trim() || s.defaultSemester, start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, weeks });
    host.haptics.success();
    host.dismiss('/schedule');
  };

  return (
    <SheetScreen title={s.semesterTitle} primary={s.save} onPrimary={save} primaryDisabled={!start}>
      <Text variant="callout" tone="muted">
        {s.semesterIntro}
      </Text>
      <Field label={s.name} value={name} onChangeText={setName} placeholder={s.semesterPlaceholder} />
      <DateTimeField label={s.firstDay} value={start} onChange={setStart} mode="date" placeholder={s.pickDate} />
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          {s.teachingWeeks}
        </Text>
        <Stepper label={s.teachingWeeks} value={weeks} onChange={setWeeks} min={1} max={30} suffix={s.weeksSuffix} />
      </View>
    </SheetScreen>
  );
}
