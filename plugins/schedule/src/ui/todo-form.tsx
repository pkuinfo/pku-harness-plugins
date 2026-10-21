import { describeTrigger, type PluginScreenProps, type Trigger } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { strings } from './strings';

type RemindMode = 'none' | 'atDue' | 'before15' | 'before60' | 'custom';
/** Create or edit a to-do: title, notes, due time, reminder. */
export function TodoForm({ host, services, params }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, Segmented, Text } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const id = params.id ?? 'new';
  const existing = id === 'new' ? undefined : services.todos.get(id);
  const job = existing?.jobId ? services.scheduler.get(existing.jobId) : undefined;
  const [title, setTitle] = useState(existing?.title ?? params.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [due, setDue] = useState<Date | null>(existing?.dueAt ? new Date(existing.dueAt) : null);
  const [mode, setMode] = useState<RemindMode>(() => {
    if (!job) return 'none';
    if (job.trigger.type !== 'at' || !existing?.dueAt) return 'custom';
    const diff = existing.dueAt - job.trigger.at;
    return diff === 0 ? 'atDue' : diff === 15 * 60_000 ? 'before15' : diff === 60 * 60_000 ? 'before60' : 'custom';
  });
  const [hadCustom] = useState(mode === 'custom');

  const remind = (): Trigger | null | undefined => {
    if (mode === 'custom') return undefined;
    if (mode === 'none' || !due) return null;
    const before = mode === 'before15' ? 15 : mode === 'before60' ? 60 : 0;
    return { type: 'at', at: due.getTime() - before * 60_000 };
  };

  const save = async () => {
    const dueAt = due ? due.getTime() : null;
    if (existing) await services.todos.update(existing.id, { title, notes, dueAt, remind: remind() }, 'user');
    else await services.todos.add({ title, notes, dueAt, remind: remind() }, 'user');
    host.haptics.success();
    host.dismiss('/schedule');
  };

  return (
    <SheetScreen
      title={existing ? s.editTodo : s.newTodo}
      primary={s.save}
      onPrimary={save}
      primaryDisabled={!title.trim()}
      danger={existing ? s.delete : undefined}
      onDanger={async () => {
        host.haptics.warning();
        if (existing) await services.todos.remove(existing.id);
        host.dismiss('/schedule');
      }}>
      <Field label={s.todoTitle} value={title} onChangeText={setTitle} placeholder={s.todoPlaceholder} autoFocus={!existing && !params.title} />
      <Field label={s.notes} value={notes} onChangeText={setNotes} placeholder={s.optional} multiline />
      <DateTimeField label={s.due} value={due} onChange={setDue} onClear={() => setDue(null)} />
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          {s.remind}
        </Text>
        <Segmented options={hadCustom ? [...s.modes, { label: s.custom, value: 'custom' }] : s.modes} value={mode} onChange={(v) => setMode(v as RemindMode)} />
        {mode === 'custom' && job ? (
          <Text variant="caption" tone="muted">
            {s.customHint(describeTrigger(job.trigger, Date.now(), locale))}
          </Text>
        ) : null}
        {mode !== 'none' && mode !== 'custom' && !due ? (
          <Text variant="caption" tone="warn">
            {s.needDue}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}
