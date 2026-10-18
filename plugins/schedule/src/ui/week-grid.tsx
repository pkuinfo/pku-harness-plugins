import { classesOn, type Course, type HostUI, type Semester } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { addDays, form, mondayOf, sameDay } from './util';

const HOUR = 52;
const GUTTER = 34;
const LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const mins = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

/** Week timetable: day columns × hours, course blocks, a "now" line on today. */
export function WeekGrid({ host, courses, semester, selected, now }: { host: HostUI; courses: Course[]; semester: Semester | null; selected: Date; now: Date }) {
  const { Text, Pressable } = host.components;
  const t = host.useTheme();
  const monday = mondayOf(selected);
  const days = LABELS.map((_, i) => addDays(monday, i));
  const perDay = days.map((d) => classesOn(courses, d, semester));
  const shown = perDay[5].length + perDay[6].length > 0 ? 7 : 5;
  const all = perDay.flat();
  const startHour = Math.min(8, ...all.map((x) => Math.floor(mins(x.start) / 60)));
  const endHour = Math.max(21, ...all.map((x) => Math.ceil(mins(x.end) / 60)));
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const colWidth = (t.contentWidth - t.spacing.lg * 2 - GUTTER) / shown;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayIndex = days.findIndex((d) => sameDay(d, now));

  return (
    <View>
      <View style={[styles.headRow, { paddingLeft: GUTTER, paddingBottom: t.spacing.sm }]}>
        {days.slice(0, shown).map((d, i) => (
          <View key={i} style={[styles.head, { width: colWidth, gap: t.spacing.xxs }]}>
            <Text variant="micro" tone={i === todayIndex ? 'accent' : 'faint'}>
              周{LABELS[i]}
            </Text>
            <Text variant="callout" tone={i === todayIndex ? 'accent' : 'default'}>
              {d.getDate()}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ height: hours.length * HOUR, flexDirection: 'row' }}>
        <View style={{ width: GUTTER }}>
          {hours.map((h) => (
            <Text key={h} variant="micro" tone="faint" style={[styles.hour, { top: (h - startHour) * HOUR }]}>
              {h}
            </Text>
          ))}
        </View>
        {days.slice(0, shown).map((_d, i) => (
          <View key={i} style={[{ width: colWidth, height: hours.length * HOUR, borderLeftColor: t.colors.border, borderLeftWidth: StyleSheet.hairlineWidth }, i === todayIndex && { backgroundColor: t.colors.surface }]}>
            {hours.map((h) => (
              <View key={h} style={[styles.line, { top: (h - startHour) * HOUR, backgroundColor: t.colors.border }]} />
            ))}
            {perDay[i].map((x) => {
              const top = ((mins(x.start) - startHour * 60) / 60) * HOUR;
              const height = Math.max(28, ((mins(x.end) - mins(x.start)) / 60) * HOUR - 2);
              const color = t.courseColor(x.color);
              return (
                <Pressable
                  key={x.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${x.name} ${x.start}-${x.end}`}
                  onPress={() => host.navigate(form('course', { id: x.id }))}
                  scaleTo={0.96}
                  style={[styles.block, { top, height, backgroundColor: color.fill, borderLeftColor: color.ink, borderRadius: t.radius.sm, paddingHorizontal: t.spacing.xs, paddingVertical: t.spacing.xxs, gap: t.spacing.xxs }]}>
                  <Text variant="micro" numberOfLines={height > 70 ? 3 : 2} style={{ color: color.ink }}>
                    {x.name}
                  </Text>
                  {x.location && height > 56 ? (
                    <Text variant="micro" tone="muted" numberOfLines={2}>
                      {x.location}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {i === todayIndex && nowMin >= startHour * 60 && nowMin <= endHour * 60 ? (
              <View style={[styles.now, { top: ((nowMin - startHour * 60) / 60) * HOUR, backgroundColor: t.colors.accent }]} />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row' },
  head: { alignItems: 'center' },
  hour: { position: 'absolute', left: 0, marginTop: -7, fontVariant: ['tabular-nums'] },
  line: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  block: { position: 'absolute', left: 2, right: 2, borderCurve: 'continuous', borderLeftWidth: 3, overflow: 'hidden' },
  now: { position: 'absolute', left: 0, right: 0, height: 2 },
});
