import { formatLocalDate, type AppLocale, type HostServices, type HostUI, type Todo } from '@pku-harness/sdk';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { strings } from './strings';
import { clock, form, sameDay } from './util';

function dueLabel(todo: Todo, now: Date, locale: AppLocale): { text: string; tone: 'down' | 'warn' | 'neutral' } | null {
  if (todo.dueAt == null) return null;
  const d = new Date(todo.dueAt);
  const overdue = !todo.doneAt && todo.dueAt < now.getTime();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = strings[locale];
  const day = sameDay(d, now) ? s.today : sameDay(d, tomorrow) ? s.tomorrow : formatLocalDate(d, locale, now);
  return { text: `${overdue ? s.overdue : ''}${day}${locale === 'en' && !sameDay(d, now) && !sameDay(d, tomorrow) ? ',' : ''} ${clock(d)}`, tone: overdue ? 'down' : sameDay(d, now) ? 'warn' : 'neutral' };
}

function TodoRow({ host, services, todo, now }: { host: HostUI; services: HostServices; todo: Todo; now: Date }) {
  const { Text, Chip, Icon, Checkbox, Pressable } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const due = dueLabel(todo, now, locale);
  const done = !!todo.doneAt;
  return (
    <View style={[styles.row, { gap: t.spacing.sm, paddingLeft: t.spacing.sm, paddingRight: t.spacing.lg }]}>
      <Checkbox
        label={s.complete(todo.title)}
        value={done}
        onValueChange={(v) => {
          if (v) host.haptics.success();
          services.todos.setDone(todo.id, v);
        }}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.edit(todo.title)}
        haptic={false}
        scaleTo={0.99}
        onPress={() => host.navigate(form('todo', { id: todo.id }))}
        style={{ flex: 1, gap: t.spacing.xs, paddingVertical: t.spacing.sm }}>
        <Text variant="body" tone={done ? 'faint' : 'default'} numberOfLines={2} style={done ? { textDecorationLine: 'line-through' } : undefined}>
          {todo.title}
        </Text>
        {due || todo.jobId ? (
          <View style={[styles.meta, { gap: t.spacing.sm }]}>
            {due ? <Chip label={due.text} tone={done ? 'neutral' : due.tone} /> : null}
            {todo.jobId && !done ? <Icon name="bell" size={12} color={t.colors.textFaint} /> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

/** Open to-dos, quick add, and a collapsible "done" group. */
export function TodoList({ host, services, todos, now }: { host: HostUI; services: HostServices; todos: Todo[]; now: Date }) {
  const { Text, Icon, Pressable } = host.components;
  const t = host.useTheme();
  const { GlassEdges } = host.components;
  const s = strings[host.useLocale()];
  const [draft, setDraft] = useState('');
  const [showDone, setShowDone] = useState(false);
  const open = todos.filter((x) => !x.doneAt);
  const done = todos.filter((x) => x.doneAt);

  const submit = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    host.haptics.tap();
    await services.todos.add({ title }, 'user');
  };

  return (
    <View style={[styles.group, { backgroundColor: t.colors.surface, borderRadius: t.radius.lg }]}>
      <GlassEdges radius={t.radius.lg} />
      {open.map((x) => (
        <TodoRow key={x.id} host={host} services={services} todo={x} now={now} />
      ))}
      <View style={[styles.add, { gap: t.spacing.md, paddingHorizontal: t.spacing.lg }, open.length > 0 && { borderTopColor: t.colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
        <Icon name="plus" size={18} color={t.colors.accent} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          placeholder={s.addTodoPlaceholder}
          placeholderTextColor={t.colors.textFaint}
          returnKeyType="done"
          submitBehavior="submit"
          accessibilityLabel={s.addTodo}
          style={[t.typography.body, styles.input, { color: t.colors.text, paddingVertical: t.spacing.sm }]}
        />
        {draft ? (
          <Pressable accessibilityRole="button" accessibilityLabel={s.moreOptions} onPress={() => host.navigate(form('todo', { id: 'new', title: draft }))}>
            <Text variant="callout" tone="accent">
              {s.details}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {done.length ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showDone ? s.hideDone : s.showDone}
            haptic={false}
            onPress={() => setShowDone((v) => !v)}
            style={[styles.doneToggle, { gap: t.spacing.xs, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, borderTopColor: t.colors.border }]}>
            <Text variant="caption" tone="faint">
              {s.doneCount(done.length)}
            </Text>
            <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={14} color={t.colors.textFaint} />
          </Pressable>
          {showDone ? done.slice(0, 20).map((x) => <TodoRow key={x.id} host={host} services={services} todo={x} now={now} />) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderCurve: 'continuous', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  meta: { flexDirection: 'row', alignItems: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  input: { flex: 1 },
  doneToggle: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
