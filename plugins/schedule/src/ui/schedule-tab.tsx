import { classesOn, formatLocalDate, weekOf, type HostUI, type PluginScreenProps } from '@pku-harness/sdk';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ClassList } from './class-list';
import { ReminderList } from './reminder-list';
import { strings } from './strings';
import { TodoList } from './todo-list';
import { form, sameDay } from './util';
import { WeekGrid } from './week-grid';
import { WeekNav, WeekStrip } from './week-strip';

function Section({ host, title, meta, children }: { host: HostUI; title: string; meta?: string; children: ReactNode }) {
  const { Text } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={[styles.sectionHead, { paddingHorizontal: t.spacing.xs }]}>
        <Text variant="micro" tone="faint">
          {title}
        </Text>
        {meta ? (
          <Text variant="micro" tone="faint">
            {meta}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Schedule tab: classes, to-dos and reminders for a day, or the week timetable. */
export function ScheduleTab({ host, services }: PluginScreenProps) {
  const { Screen, Text, Icon, Pressable, Segmented, FadeIn, ListGroup, ListRow, Chip } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const { GlassEdges } = host.components;
  host.useStoreVersion();
  const now = host.useNow();
  const { courses, semester, reminderMinutes } = services.timetable.get();
  const todos = services.todos.list();
  const jobs = services.scheduler.list();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [selected, setSelected] = useState(() => new Date());

  const dayClasses = classesOn(courses, selected, semester);
  const week = weekOf(semester, selected);
  const isToday = sameDay(selected, now);
  const openTodos = todos.filter((x) => !x.doneAt).length;
  const reminders = jobs
    .filter((j) => !j.meta?.todoId && !j.meta?.courseId)
    .filter((j) => j.nextRunAt != null || (j.lastRunAt != null && now.getTime() - j.lastRunAt < 86_400_000))
    .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  const subtitle = `${formatLocalDate(selected, locale, now)}${week && week >= 1 && semester && week <= semester.weeks ? s.weekN(week) : ''}`;

  const quick = (icon: string, label: string, href: string) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => host.navigate(href)}
      style={[styles.quick, { backgroundColor: t.colors.surface, gap: t.spacing.xs, paddingVertical: t.spacing.md, borderRadius: t.radius.lg }]}>
      <GlassEdges radius={t.radius.lg} />
      <Icon name={icon} size={16} color={t.colors.accent} />
      <Text variant="callout">{label}</Text>
    </Pressable>
  );

  return (
    <Screen title={s.title} subtitle={subtitle}>
      <FadeIn index={0}>
        <View style={{ gap: t.spacing.md }}>
          <Segmented
            options={[
              { label: s.viewDay, value: 'day' },
              { label: s.viewWeek, value: 'week' },
            ]}
            value={view}
            onChange={(v) => setView(v as 'day' | 'week')}
          />
          {view === 'day' ? (
            <WeekStrip host={host} selected={selected} onSelect={setSelected} hasClasses={(d) => classesOn(courses, d, semester).length > 0} />
          ) : (
            <WeekNav host={host} selected={selected} onSelect={setSelected} week={week} />
          )}
        </View>
      </FadeIn>

      {view === 'day' ? (
        <>
          <FadeIn index={1}>
            <View style={[styles.quickRow, { gap: t.spacing.sm }]}>
              {quick('todo', s.todo, form('todo', { id: 'new' }))}
              {quick('bell', s.reminder, form('reminder', { id: 'new' }))}
              {quick('book', s.course, form('course', { id: 'new' }))}
            </View>
          </FadeIn>
          <FadeIn index={2}>
            <Section host={host} title={isToday ? s.todayClasses : s.classes} meta={dayClasses.length ? s.classCount(dayClasses.length) : undefined}>
              <ClassList host={host} classes={dayClasses} isToday={isToday} now={now} />
            </Section>
          </FadeIn>
          <FadeIn index={3}>
            <Section host={host} title={s.todo} meta={openTodos ? s.todoCount(openTodos) : undefined}>
              <TodoList host={host} services={services} todos={todos} now={now} />
            </Section>
          </FadeIn>
          <FadeIn index={4}>
            <Section host={host} title={s.remindersTitle} meta={reminders.length ? s.reminderCount(reminders.length) : undefined}>
              {reminders.length ? (
                <ReminderList host={host} services={services} jobs={reminders} />
              ) : (
                <Text variant="callout" tone="muted">
                  {s.noReminders}
                </Text>
              )}
            </Section>
          </FadeIn>
        </>
      ) : (
        <FadeIn>
          <View style={{ gap: t.spacing.xl }}>
            {courses.length ? (
              <WeekGrid host={host} courses={courses} semester={semester} selected={selected} now={now} />
            ) : (
              <Text variant="callout" tone="muted">
                {s.emptyTimetable}
              </Text>
            )}
            <ListGroup title={s.timetableSettings}>
              <ListRow
                icon="schedule"
                title={s.semester}
                subtitle={semester ? s.semesterInfo(semester.name, semester.start, semester.weeks) : s.noSemester}
                onPress={() => host.navigate(form('semester'))}
              />
              <ListRow icon="plus" title={s.addClass} onPress={() => host.navigate(form('course', { id: 'new' }))} />
              {services.registry.plugins().some((p) => p.id === 'course-sync' && p.enabled) ? (
                <ListRow icon="refresh" title={s.syncFromSchool} subtitle={s.syncPlugin} onPress={() => host.navigate('/p/course-sync/home')} />
              ) : null}
            </ListGroup>
            <View style={{ gap: t.spacing.sm }}>
              <View style={[styles.sectionHead, { paddingHorizontal: t.spacing.xs }]}>
                <Text variant="micro" tone="faint">
                  {s.classReminders}
                </Text>
                {reminderMinutes != null ? <Chip label={s.remindersSet(courses.length)} tone="up" /> : null}
              </View>
              <Segmented
                options={s.leads}
                value={reminderMinutes == null ? 'off' : String(reminderMinutes)}
                onChange={(v) => services.timetable.setReminderMinutes(v === 'off' ? null : Number(v))}
              />
            </View>
          </View>
        </FadeIn>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickRow: { flexDirection: 'row' },
  quick: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderCurve: 'continuous' },
});
