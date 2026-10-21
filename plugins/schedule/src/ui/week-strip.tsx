import type { HostUI } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';
import { addDays, mondayOf, sameDay } from './util';

/** Monday-first week of the selected day; dots mark days with classes. */
export function WeekStrip({ host, selected, onSelect, hasClasses }: { host: HostUI; selected: Date; onSelect: (d: Date) => void; hasClasses: (d: Date) => boolean }) {
  const { Text, IconButton, Pressable } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const monday = mondayOf(selected);
  const today = new Date();
  return (
    <View style={[styles.wrap, { gap: t.spacing.xs }]}>
      <IconButton icon="back" label={s.prevWeek} variant="ghost" size={32} onPress={() => onSelect(addDays(selected, -7))} />
      <View style={styles.days}>
        {s.weekdayShort.map((label, i) => {
          const day = addDays(monday, i);
          const isSel = sameDay(day, selected);
          const isToday = sameDay(day, today);
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={s.dayA11y(label, day.getMonth() + 1, day.getDate())}
              haptic={false}
              onPress={() => {
                host.haptics.select();
                onSelect(day);
              }}
              style={[styles.day, { gap: t.spacing.xxs, paddingVertical: t.spacing.sm, borderRadius: t.radius.md }, isSel && { backgroundColor: t.colors.brand, boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.2)' }]}>
              <Text variant="micro" tone={isSel ? 'onAccent' : 'faint'}>
                {label}
              </Text>
              <Text variant="bodyStrong" tone={isSel ? 'onAccent' : isToday ? 'accent' : 'default'}>
                {day.getDate()}
              </Text>
              <View style={[styles.dot, { borderRadius: t.radius.full, backgroundColor: hasClasses(day) ? (isSel ? t.colors.onAccent : t.colors.textFaint) : 'transparent' }]} />
            </Pressable>
          );
        })}
      </View>
      <IconButton icon="chevronRight" label={s.nextWeek} variant="ghost" size={32} onPress={() => onSelect(addDays(selected, 7))} />
    </View>
  );
}

/** Compact week navigator for the timetable view. */
export function WeekNav({ host, selected, onSelect, week }: { host: HostUI; selected: Date; onSelect: (d: Date) => void; week: number | null }) {
  const { Text, IconButton, Pressable } = host.components;
  const t = host.useTheme();
  const monday = mondayOf(selected);
  const sunday = addDays(monday, 6);
  const s = strings[host.useLocale()];
  return (
    <View style={[styles.wrap, { gap: t.spacing.xs }]}>
      <IconButton icon="back" label={s.prevWeek} variant="ghost" size={32} onPress={() => onSelect(addDays(selected, -7))} />
      <Pressable accessibilityRole="button" accessibilityLabel={s.thisWeekA11y} style={[styles.nav, { gap: t.spacing.xxs }]} onPress={() => onSelect(new Date())}>
        <Text variant="bodyStrong">{week != null && week >= 1 ? s.week(week) : s.thisWeek}</Text>
        <Text variant="caption" tone="muted">
          {s.range(monday.getMonth() + 1, monday.getDate(), sunday.getMonth() + 1, sunday.getDate())}
        </Text>
      </Pressable>
      <IconButton icon="chevronRight" label={s.nextWeek} variant="ghost" size={32} onPress={() => onSelect(addDays(selected, 7))} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center' },
  days: { flex: 1, flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', width: 40, borderCurve: 'continuous' },
  dot: { width: 4, height: 4 },
  nav: { flex: 1, alignItems: 'center' },
});
