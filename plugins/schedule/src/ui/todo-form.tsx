import { describeTrigger, firstDue, repeatRuleOf, todoRepeat, type PluginScreenProps, type RepeatRule, type Trigger } from '@pku-harness/sdk';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';
import { dayAt, jsWeekday } from './util';

type RemindMode = 'none' | 'atDue' | 'before15' | 'before60' | 'custom';
type RepeatMode = 'none' | 'day' | 'week';
type End = 'never' | 'count' | 'until';

/** Create or edit a to-do: title, notes, due time, priority, repeat, reminder. */
export function TodoForm({ host, services, params }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, Segmented, Text, Switch, Stepper, WeekdayPicker, Icon } = host.components;
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
  const [important, setImportant] = useState(existing?.priority === 'high');
  const rule0 = existing?.repeat ? repeatRuleOf(existing.repeat) : null;
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(rule0?.unit ?? 'none');
  const [interval, setInterval] = useState(rule0?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(rule0?.weekdays ?? [jsWeekday(due ?? Date.now())]);
  const [end, setEnd] = useState<End>(rule0?.count ? 'count' : rule0?.until ? 'until' : 'never');
  const [count, setCount] = useState(rule0?.count ?? 10);
  const [until, setUntil] = useState<Date>(() => (rule0?.until ? new Date(rule0.until) : new Date(Date.now() + 90 * 86_400_000)));

  const rule = (): RepeatRule | null =>
    repeatMode === 'none'
      ? null
      : {
          unit: repeatMode,
          interval,
          weekdays: repeatMode === 'week' ? weekdays : undefined,
          count: end === 'count' ? count : undefined,
          until: end === 'until' ? dayAt(until, 23, 59) : undefined,
        };
  const r = rule();
  // Without a due time a repeating to-do starts on the next matching day (like the tool does).
  const effectiveDue = due ? due.getTime() : r ? firstDue(r, Date.now()) : null;
  // Unchanged rule and due time: keep the stored series (its anchor bounds `count` across instances).
  const unchanged = existing?.repeat && existing.dueAt === effectiveDue && JSON.stringify(rule0) === JSON.stringify(r);
  const repeat = unchanged ? existing.repeat : r && effectiveDue != null ? todoRepeat(r, effectiveDue) : null;

  const remind = (dueAt: number | null): Trigger | null | undefined => {
    if (mode === 'custom') return undefined;
    if (mode === 'none' || dueAt == null) return null;
    const before = mode === 'before15' ? 15 : mode === 'before60' ? 60 : 0;
    return { type: 'at', at: dueAt - before * 60_000 };
  };

  const save = async () => {
    const dueAt = effectiveDue;
    const fields = { title, notes, dueAt, remind: remind(dueAt), priority: important ? ('high' as const) : ('none' as const), repeat };
    if (existing) await services.todos.update(existing.id, fields, 'user');
    else await services.todos.add(fields, 'user');
    host.haptics.success();
    host.dismiss('/schedule');
  };

  return (
    <SheetScreen
      title={existing ? s.editTodo : s.newTodo}
      primary={s.save}
      onPrimary={save}
      primaryDisabled={!title.trim() || (!!r && !repeat)}
      danger={existing ? s.delete : undefined}
      onDanger={async () => {
        host.haptics.warning();
        if (existing) await services.todos.remove(existing.id);
        host.dismiss('/schedule');
      }}>
      <Field label={s.todoTitle} value={title} onChangeText={setTitle} placeholder={s.todoPlaceholder} autoFocus={!existing && !params.title} />
      <Field label={s.notes} value={notes} onChangeText={setNotes} placeholder={s.optional} multiline />
      <DateTimeField label={s.due} value={due} onChange={setDue} onClear={() => setDue(null)} />
      <View style={[styles.line, { gap: t.spacing.md }]}>
        <Icon name="flag" size={16} color={important ? t.colors.warn : t.colors.textFaint} />
        <View style={{ flex: 1, gap: t.spacing.xxs }}>
          <Text variant="body">{s.important}</Text>
          <Text variant="caption" tone="muted">
            {s.importantHint}
          </Text>
        </View>
        <Switch
          label={s.important}
          value={important}
          onValueChange={(v) => {
            host.haptics.select();
            setImportant(v);
          }}
        />
      </View>
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          {s.repeatTodo}
        </Text>
        <Segmented options={s.repeatModes} value={repeatMode} onChange={(v) => setRepeatMode(v as RepeatMode)} />
        {repeatMode !== 'none' ? (
          <>
            <View style={[styles.line, { gap: t.spacing.sm }]}>
              <Text variant="body">{s.every}</Text>
              <Stepper label={s.interval} value={interval} onChange={setInterval} max={365} />
              <Text variant="body">{s.unit(repeatMode, interval)}</Text>
            </View>
            {repeatMode === 'week' ? <WeekdayPicker value={weekdays} onChange={(v) => setWeekdays(v.length ? v : weekdays)} multiple /> : null}
            <Segmented options={s.ends} value={end} onChange={(v) => setEnd(v as End)} />
            {end === 'count' ? (
              <View style={[styles.line, { gap: t.spacing.sm }]}>
                <Text variant="body">{s.countBefore}</Text>
                <Stepper label={s.countLabel} value={count} onChange={setCount} max={999} />
                <Text variant="body">{s.countAfter(count)}</Text>
              </View>
            ) : null}
            {end === 'until' ? <DateTimeField label={s.untilDate} value={until} onChange={setUntil} mode="date" /> : null}
            <View style={[styles.line, { gap: t.spacing.xs }]}>
              <Icon name="repeat" size={14} color={t.colors.textMuted} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                {repeat ? `${describeTrigger(repeat, Date.now(), locale)} · ${s.repeatHint}` : s.passed}
              </Text>
            </View>
            {!due ? (
              <Text variant="caption" tone="faint">
                {s.repeatNeedsDue}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
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
        {mode !== 'none' && mode !== 'custom' && effectiveDue == null ? (
          <Text variant="caption" tone="warn">
            {s.needDue}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
});
