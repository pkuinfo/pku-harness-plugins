import type { HostUI } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { addDays, mondayOf, sameDay } from './util';

const LABELS = ['一', '二', '三', '四', '五', '六', '日'];

/** Monday-first week of the selected day; dots mark days with classes. */
export function WeekStrip({ host, selected, onSelect, hasClasses }: { host: HostUI; selected: Date; onSelect: (d: Date) => void; hasClasses: (d: Date) => boolean }) {
  const { Text, IconButton, Pressable } = host.components;
  const t = host.useTheme();
  const monday = mondayOf(selected);
  const today = new Date();
  return (
    <View style={[styles.wrap, { gap: t.spacing.xs }]}>
      <IconButton icon="back" label="上一周" variant="ghost" size={32} onPress={() => onSelect(addDays(selected, -7))} />
      <View style={styles.days}>
        {LABELS.map((label, i) => {
          const day = addDays(monday, i);
          const isSel = sameDay(day, selected);
          const isToday = sameDay(day, today);
          return (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={`周${label} ${day.getMonth() + 1}月${day.getDate()}日`}
              haptic={false}
              onPress={() => {
                host.haptics.select();
                onSelect(day);
              }}
              style={[styles.day, { gap: t.spacing.xxs, paddingVertical: t.spacing.sm, borderRadius: t.radius.md }, isSel && { backgroundColor: t.colors.accent }]}>
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
      <IconButton icon="chevronRight" label="下一周" variant="ghost" size={32} onPress={() => onSelect(addDays(selected, 7))} />
    </View>
  );
}

/** Compact week navigator for the timetable view. */
export function WeekNav({ host, selected, onSelect, week }: { host: HostUI; selected: Date; onSelect: (d: Date) => void; week: number | null }) {
  const { Text, IconButton, Pressable } = host.components;
  const t = host.useTheme();
  const monday = mondayOf(selected);
  const sunday = addDays(monday, 6);
  return (
    <View style={[styles.wrap, { gap: t.spacing.xs }]}>
      <IconButton icon="back" label="上一周" variant="ghost" size={32} onPress={() => onSelect(addDays(selected, -7))} />
      <Pressable accessibilityRole="button" accessibilityLabel="回到本周" style={[styles.nav, { gap: t.spacing.xxs }]} onPress={() => onSelect(new Date())}>
        <Text variant="bodyStrong">{week != null && week >= 1 ? `第 ${week} 周` : '本周'}</Text>
        <Text variant="caption" tone="muted">
          {`${monday.getMonth() + 1}月${monday.getDate()}日 – ${sunday.getMonth() + 1}月${sunday.getDate()}日`}
        </Text>
      </Pressable>
      <IconButton icon="chevronRight" label="下一周" variant="ghost" size={32} onPress={() => onSelect(addDays(selected, 7))} />
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
