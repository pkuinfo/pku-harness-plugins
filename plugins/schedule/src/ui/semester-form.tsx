import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

const pad = (n: number) => String(n).padStart(2, '0');

/** Semester dates for teaching weeks and class reminders (calendar.setSemester). */
export function SemesterForm({ host, services, invoke }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, Stepper, Text } = host.components;
  const t = host.useTheme();
  const cur = services.timetable.get().semester;
  const [name, setName] = useState(cur?.name ?? '');
  const [start, setStart] = useState<Date | null>(() => (cur ? new Date(`${cur.start}T00:00:00`) : null));
  const [weeks, setWeeks] = useState(cur?.weeks ?? 16);

  const save = async () => {
    if (!start) return;
    await invoke('calendar.setSemester', { name: name.trim() || '本学期', start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`, weeks });
    host.haptics.success();
    host.dismiss('/schedule');
  };

  return (
    <SheetScreen title="学期设置" primary="保存" onPrimary={save} primaryDisabled={!start}>
      <Text variant="callout" tone="muted">
        用于计算教学周、筛选单双周课程和上课提醒的起止。登录校园账号后会自动同步校历。
      </Text>
      <Field label="名称" value={name} onChangeText={setName} placeholder="例如：2026 秋季学期" />
      <DateTimeField label="第 1 周的第一天" value={start} onChange={setStart} mode="date" placeholder="选择日期" />
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          教学周数
        </Text>
        <Stepper label="教学周数" value={weeks} onChange={setWeeks} min={1} max={30} suffix=" 周" />
      </View>
    </SheetScreen>
  );
}
