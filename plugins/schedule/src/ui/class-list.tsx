import { classStatus, type Course, type HostUI } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';
import { form } from './util';

function ClassCard({ host, course, now, isToday, isNext }: { host: HostUI; course: Course; now: Date; isToday: boolean; isNext: boolean }) {
  const { Text, Chip, Pressable } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const { GlassEdges } = host.components;
  const color = t.courseColor(course.color);
  const status = isToday ? classStatus(course, now) : null;
  const done = status?.state === 'after';
  const ongoing = status?.state === 'ongoing';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={s.classA11y(course.name, course.start, course.end, course.location ?? '')}
      onPress={() => host.navigate(form('course', { id: course.id }))}
      scaleTo={0.98}
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, opacity: done ? 0.55 : 1, gap: t.spacing.md, padding: t.spacing.md, borderRadius: t.radius.lg },
        ongoing && { borderColor: color.ink },
      ]}>
      <GlassEdges radius={t.radius.lg} />
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
      {ongoing ? <Chip label={s.ongoing} tone="up" /> : isNext && status?.state === 'before' ? <Chip label={s.until(status.minutesToStart)} tone="accent" /> : null}
    </Pressable>
  );
}

/** Classes of one day; today shows live status (ongoing progress, countdown to the next). */
export function ClassList({ host, classes, isToday, now }: { host: HostUI; classes: Course[]; isToday: boolean; now: Date }) {
  const { Text, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  if (!classes.length) {
    return (
      <View style={[styles.empty, { paddingVertical: t.spacing.sm }]}>
        <Text variant="callout" tone="muted">
          {s.noClassesThatDay}
        </Text>
        <Button title={s.addClass} size="sm" variant="secondary" icon="plus" onPress={() => host.navigate(form('course', { id: 'new' }))} />
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
