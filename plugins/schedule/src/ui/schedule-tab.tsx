import { classesOn, weekOf, type HostUI, type PluginScreenProps } from '@pku-harness/sdk';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ClassList } from './class-list';
import { ReminderList } from './reminder-list';
import { TodoList } from './todo-list';
import { form, sameDay } from './util';
import { WeekGrid } from './week-grid';
import { WeekNav, WeekStrip } from './week-strip';

const LEADS = [
  { label: '关', value: 'off' },
  { label: '5 分', value: '5' },
  { label: '10 分', value: '10' },
  { label: '15 分', value: '15' },
  { label: '30 分', value: '30' },
];

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
  const subtitle = `${selected.getMonth() + 1}月${selected.getDate()}日${week && week >= 1 && semester && week <= semester.weeks ? ` · 第 ${week} 周` : ''}`;

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
    <Screen title="日程" subtitle={subtitle}>
      <FadeIn index={0}>
        <View style={{ gap: t.spacing.md }}>
          <Segmented
            options={[
              { label: '日程', value: 'day' },
              { label: '课表', value: 'week' },
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
              {quick('todo', '待办', form('todo', { id: 'new' }))}
              {quick('bell', '提醒', form('reminder', { id: 'new' }))}
              {quick('book', '课程', form('course', { id: 'new' }))}
            </View>
          </FadeIn>
          <FadeIn index={2}>
            <Section host={host} title={isToday ? '今天的课' : '课程'} meta={dayClasses.length ? `${dayClasses.length} 节` : undefined}>
              <ClassList host={host} classes={dayClasses} isToday={isToday} now={now} />
            </Section>
          </FadeIn>
          <FadeIn index={3}>
            <Section host={host} title="待办" meta={openTodos ? `${openTodos} 项` : undefined}>
              <TodoList host={host} services={services} todos={todos} now={now} />
            </Section>
          </FadeIn>
          <FadeIn index={4}>
            <Section host={host} title="提醒与定时任务" meta={reminders.length ? `${reminders.length} 个` : undefined}>
              {reminders.length ? (
                <ReminderList host={host} services={services} jobs={reminders} />
              ) : (
                <Text variant="callout" tone="muted">
                  还没有提醒。可以点上面的「提醒」，或在对话里说「每 3 天提醒我交水费，共 16 次」。
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
                课表是空的。可以从学校同步、手动添加，或在对话里把课表发给 AI。
              </Text>
            )}
            <ListGroup title="课表设置">
              <ListRow
                icon="schedule"
                title="学期"
                subtitle={semester ? `${semester.name} · ${semester.start} 起 · ${semester.weeks} 周` : '未设置，教学周和单双周无法计算'}
                onPress={() => host.navigate(form('semester'))}
              />
              <ListRow icon="plus" title="添加课程" onPress={() => host.navigate(form('course', { id: 'new' }))} />
              {services.registry.plugins().some((p) => p.id === 'course-sync' && p.enabled) ? (
                <ListRow icon="refresh" title="从学校同步课表" subtitle="教务课表插件" onPress={() => host.navigate('/p/course-sync/home')} />
              ) : null}
            </ListGroup>
            <View style={{ gap: t.spacing.sm }}>
              <View style={[styles.sectionHead, { paddingHorizontal: t.spacing.xs }]}>
                <Text variant="micro" tone="faint">
                  上课提醒（提前）
                </Text>
                {reminderMinutes != null ? <Chip label={`已为 ${courses.length} 门课设置`} tone="up" /> : null}
              </View>
              <Segmented
                options={LEADS}
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
