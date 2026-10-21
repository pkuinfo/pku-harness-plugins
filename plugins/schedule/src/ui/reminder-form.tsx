import { describeTrigger, formatLocalDateTime, formatTime, formatWeekday, occurrencesAfter, summarize, type PluginScreenProps, type Trigger } from '@pku-harness/sdk';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';

type Unit = 'day' | 'week' | 'hour' | 'minute';
type End = 'never' | 'count' | 'until';

const toDate = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
};

/** Create or edit a stand-alone reminder (or the schedule of a check job). */
export function ReminderForm({ host, services, params }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, Segmented, Stepper, WeekdayPicker, Text, Chip, Icon, IconButton, Button, Surface } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const { GlassEdges } = host.components;
  const id = params.id ?? 'new';
  const existing = id === 'new' ? undefined : services.scheduler.get(id);
  const tr = existing?.trigger;
  const every = tr?.type === 'every' ? tr : undefined;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.action.type === 'notify' ? (existing.action.body ?? '') : '');
  const [kind, setKind] = useState<'once' | 'repeat'>(every ? 'repeat' : 'once');
  const [at, setAt] = useState<Date>(() => {
    if (tr?.type === 'at') return new Date(tr.at);
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [unit, setUnit] = useState<Unit>(every?.unit ?? 'day');
  const [interval, setInterval] = useState(every?.interval ?? 1);
  const [times, setTimes] = useState<string[]>(every?.times ?? ['08:00']);
  const [weekdays, setWeekdays] = useState<number[]>(every?.weekdays ?? [new Date().getDay()]);
  const [start, setStart] = useState<Date>(() => (every ? new Date(every.startAt) : new Date()));
  const [end, setEnd] = useState<End>(every?.count ? 'count' : every?.until ? 'until' : 'never');
  const [count, setCount] = useState(every?.count ?? 10);
  const [until, setUntil] = useState<Date>(() => (every?.until ? new Date(every.until) : new Date(Date.now() + 30 * 86_400_000)));
  const [openedAt] = useState(() => Date.now());

  const trigger: Trigger = useMemo(() => {
    if (kind === 'once') return { type: 'at', at: at.getTime() };
    const fine = unit === 'hour' || unit === 'minute';
    return {
      type: 'every',
      unit,
      interval,
      times: fine ? undefined : times,
      weekdays: unit === 'week' ? weekdays : undefined,
      startAt: fine ? Math.floor(start.getTime() / 60_000) * 60_000 : new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime(),
      count: end === 'count' ? count : undefined,
      until: end === 'until' ? new Date(until.getFullYear(), until.getMonth(), until.getDate(), 23, 59).getTime() : undefined,
    };
  }, [kind, at, unit, interval, times, weekdays, start, end, count, until]);
  const summary = summarize(trigger, openedAt, 3);
  const preview =
    locale === 'en'
      ? {
          ...summary,
          schedule: describeTrigger(trigger, openedAt, locale),
          // summarize() formats for the model; show the user's locale instead.
          next: occurrencesAfter(trigger, openedAt - 1, 3).map((o) => `${formatWeekday(o.at, locale)}, ${formatLocalDateTime(o.at, locale, openedAt)}`),
        }
      : summary;
  const check = existing?.action.type === 'check' ? existing.action : null;

  const save = async () => {
    const name = title.trim();
    if (existing) {
      await services.scheduler.update(existing.id, {
        title: name,
        trigger,
        action: existing.action.type === 'notify' ? { ...existing.action, title: name, body: body.trim() || undefined } : existing.action,
        enabled: true,
      });
    } else {
      await services.scheduler.create({ title: name, trigger, action: { type: 'notify', title: name, body: body.trim() || undefined, url: '/schedule' }, source: 'user' });
    }
    host.haptics.success();
    host.dismiss('/schedule');
  };

  const setTime = (i: number, d: Date) => {
    const next = times.slice();
    next[i] = formatTime(d.getHours(), d.getMinutes());
    setTimes([...new Set(next)].sort());
  };

  return (
    <SheetScreen
      title={existing ? (check ? s.editCheck : s.editReminderTitle) : s.newReminder}
      primary={s.save}
      onPrimary={save}
      primaryDisabled={!title.trim() || preview.finished}
      danger={existing ? s.delete : undefined}
      onDanger={async () => {
        host.haptics.warning();
        if (existing) await services.scheduler.remove(existing.id);
        host.dismiss('/schedule');
      }}>
      <Field label={s.reminderTitle} value={title} onChangeText={setTitle} placeholder={s.reminderPlaceholder} autoFocus={!existing} />
      {check ? (
        <Surface level={2} style={{ gap: t.spacing.xs }}>
          <Text variant="callout">
            {s.checkSummary(check.tool, check.condition.path, check.condition.op, check.condition.value != null ? String(check.condition.value) : null)}
          </Text>
          <Text variant="caption" tone="muted">
            {s.checkByAI}
          </Text>
        </Surface>
      ) : (
        <Field label={s.body} value={body} onChangeText={setBody} placeholder={s.bodyPlaceholder} />
      )}
      <Segmented
        options={[
          { label: s.once, value: 'once' },
          { label: s.repeat, value: 'repeat' },
        ]}
        value={kind}
        onChange={(v) => setKind(v as 'once' | 'repeat')}
      />
      {kind === 'once' ? (
        <DateTimeField label={s.time} value={at} onChange={setAt} />
      ) : (
        <>
          <Segmented options={s.units} value={unit} onChange={(v) => setUnit(v as Unit)} />
          <View style={[styles.line, { gap: t.spacing.sm }]}>
            <Text variant="body">{s.every}</Text>
            <Stepper label={s.interval} value={interval} onChange={setInterval} max={unit === 'hour' ? 23 : unit === 'minute' ? 720 : 365} />
            <Text variant="body">{s.unit(unit, interval)}</Text>
          </View>
          {unit === 'week' ? <WeekdayPicker value={weekdays} onChange={setWeekdays} multiple /> : null}
          {unit === 'day' || unit === 'week' ? (
            <View style={{ gap: t.spacing.sm }}>
              {times.map((tm, i) => (
                <View key={`${tm}-${i}`} style={[styles.line, { gap: t.spacing.sm }]}>
                  <View style={{ flex: 1 }}>
                    <DateTimeField label={i === 0 ? s.remindAt : s.timeN(i + 1)} value={toDate(tm)} onChange={(d) => setTime(i, d)} mode="time" />
                  </View>
                  {times.length > 1 ? <IconButton icon="close" label={s.removeTime(tm)} variant="ghost" size={36} onPress={() => setTimes(times.filter((_, j) => j !== i))} /> : null}
                </View>
              ))}
              {times.length < 12 ? (
                <Button title={s.addTime} size="sm" variant="secondary" icon="plus" onPress={() => setTimes([...new Set([...times, '12:00'])].sort())} style={{ alignSelf: 'flex-start' }} />
              ) : null}
            </View>
          ) : null}
          <DateTimeField label={unit === 'hour' || unit === 'minute' ? s.from : s.startDate} value={start} onChange={setStart} mode={unit === 'hour' || unit === 'minute' ? 'datetime' : 'date'} />
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="callout" tone="muted">
              {s.end}
            </Text>
            <Segmented options={s.ends} value={end} onChange={(v) => setEnd(v as End)} />
            {end === 'count' ? (
              <View style={[styles.line, { gap: t.spacing.sm }]}>
                <Text variant="body">{s.countBefore}</Text>
                <Stepper label={s.countLabel} value={count} onChange={setCount} max={999} />
                <Text variant="body">{s.countAfter(count)}</Text>
              </View>
            ) : null}
            {end === 'until' ? <DateTimeField label={s.untilDate} value={until} onChange={setUntil} mode="date" /> : null}
          </View>
        </>
      )}
      <View style={[styles.preview, { backgroundColor: t.colors.surface, borderColor: preview.finished ? t.colors.warn : t.colors.border, gap: t.spacing.xs, padding: t.spacing.md, borderRadius: t.radius.md }]}>
        <GlassEdges radius={t.radius.lg} />
        <View style={[styles.line, { gap: t.spacing.sm }]}>
          <Icon name="calendarClock" size={16} color={t.colors.textMuted} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {preview.schedule}
          </Text>
          {preview.total ? <Chip label={s.total(preview.total)} /> : null}
        </View>
        {preview.finished ? (
          <Text variant="caption" tone="warn">
            {s.passed}
          </Text>
        ) : (
          preview.next.map((n) => (
            <Text key={n} variant="caption" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
              {n}
            </Text>
          ))
        )}
      </View>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center' },
  preview: { borderCurve: 'continuous', borderWidth: 1 },
});
