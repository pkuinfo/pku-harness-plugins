import { classStatus, type Course, type HostUI } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { form } from './util';

function untilText(min: number) {
  if (min < 60) return `${min} 分钟后`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分后` : `${h} 小时后`;
}

function ClassCard({ host, course, now, isToday, isNext }: { host: HostUI; course: Course; now: Date; isToday: boolean; isNext: boolean }) {
  const { Text, Chip, Pressable } = host.components;
  const t = host.useTheme();
  const color = t.courseColor(course.color);
  const status = isToday ? classStatus(course, now) : null;
  const done = status?.state === 'after';
  const ongoing = status?.state === 'ongoing';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${course.name}，${course.start} 到 ${course.end}${course.location ? `，${course.location}` : ''}`}
      onPress={() => host.navigate(form('course', { id: course.id }))}
      scaleTo={0.98}
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, opacity: done ? 0.55 : 1, gap: t.spacing.md, padding: t.spacing.md, borderRadius: t.radius.lg },
        ongoing && { borderColor: color.ink },
      ]}>
      <View style={styles.time}>
        <Text variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {course.start}
        </Text>
        <Text variant="caption" tone="faint" style={{ fontVariant: ['tabular-nums'] }}>
          {course.end}
        </Text>
      </View>
      <View style={[styles.bar, { backgroundColor: color.ink, borderRadius: t.radius.full }]} />
      <View style={{ flex: 1, gap: t.spacing.xxs }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {course.name}
        </Text>
        {course.location || course.teacher ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {[course.location, course.teacher].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {ongoing ? (
          <View style={[styles.track, { backgroundColor: t.colors.surface3, borderRadius: t.radius.full, marginTop: t.spacing.xs }]}>
            <View style={[styles.fill, { width: `${Math.round(status!.progress * 100)}%`, backgroundColor: color.ink, borderRadius: t.radius.full }]} />
          </View>
        ) : null}
      </View>
      {ongoing ? <Chip label="进行中" tone="up" /> : isNext && status?.state === 'before' ? <Chip label={untilText(status.minutesToStart)} tone="accent" /> : null}
    </Pressable>
  );
}

/** Classes of one day; today shows live status (ongoing progress, countdown to the next). */
export function ClassList({ host, classes, isToday, now }: { host: HostUI; classes: Course[]; isToday: boolean; now: Date }) {
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!classes.length) {
    return (
      <View style={[styles.empty, { paddingVertical: t.spacing.sm }]}>
        <Text variant="callout" tone="muted">
          这天没有课
        </Text>
        <Button title="添加课程" size="sm" variant="secondary" icon="plus" onPress={() => host.navigate(form('course', { id: 'new' }))} />
      </View>
    );
  }
  const nextId = isToday ? classes.find((x) => classStatus(x, now).state !== 'after')?.id : undefined;
  return (
    <View style={{ gap: t.spacing.sm }}>
      {classes.map((x) => (
        <ClassCard key={x.id} host={host} course={x} now={now} isToday={isToday} isNext={x.id === nextId} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderCurve: 'continuous', borderWidth: 1, borderColor: 'transparent' },
  time: { width: 48, alignItems: 'flex-start' },
  bar: { width: 3, alignSelf: 'stretch' },
  track: { height: 4, overflow: 'hidden' },
  fill: { height: 4 },
  empty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
