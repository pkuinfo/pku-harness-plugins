import { formatClock, formatLocalDate, todosForView, type AppLocale, type HostUI, type PluginWidgetProps, type Todo } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { strings } from './strings';

const dayStart = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "18:00" today, "明天 09:00", else the date; overdue ones prefixed. */
export function dueText(dueAt: number, now: number, locale: AppLocale): string {
  const s = strings[locale];
  const days = Math.round((dayStart(dueAt) - dayStart(now)) / 86_400_000);
  const when = days === 0 ? formatClock(dueAt) : days === 1 ? `${s.tomorrow} ${formatClock(dueAt)}` : formatLocalDate(dueAt, locale, now);
  return dueAt < now ? `${s.overdue}${when}` : when;
}

function Row({ host, todo, now, onDone }: { host: HostUI; todo: Todo; now: number; onDone: () => void }) {
  const { Text, Checkbox, Icon } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const overdue = todo.dueAt != null && todo.dueAt < now;
  return (
    <View style={[styles.row, { gap: t.spacing.sm }]}>
      <Checkbox label={s.complete(todo.title)} value={false} onValueChange={(v) => v && onDone()} />
      <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
        {todo.title}
      </Text>
      {todo.priority === 'high' ? <Icon name="flag" size={13} color={t.colors.warn} /> : null}
      {todo.dueAt != null ? (
        <Text variant="caption" tone={overdue ? 'down' : 'muted'} style={{ fontVariant: ['tabular-nums'] }}>
          {dueText(todo.dueAt, now, locale)}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Today's to-dos on the dashboard: overdue + due today + undated important ones. Local data, so
 * it re-renders on every store change (from any plugin, the schedule tab or the agent) and with
 * the clock; ticking an item off goes through `todo.complete`, like the agent would.
 */
export function TodoWidget({ host, services, size, invoke }: PluginWidgetProps) {
  const { Text, Icon, Pressable } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  host.useStoreVersion();
  const now = host.useNow(60_000).getTime();
  const all = services.todos.list();
  const items = todosForView(all, 'today', now);
  const overdue = items.filter((x) => x.dueAt != null && x.dueAt < now).length;
  const next = todosForView(all, 'upcoming', now)[0];

  const complete = (todo: Todo) => {
    host.haptics.success();
    void invoke('todo.complete', { id: todo.id }).catch(() => host.haptics.warning());
  };

  let body;
  if (!items.length) {
    body = (
      <View style={{ gap: t.spacing.xs }}>
        <View style={[styles.row, { gap: t.spacing.sm }]}>
          <Icon name="leaf" size={size === 'sm' ? 18 : 20} color={t.colors.up} />
          <Text variant={size === 'sm' ? 'bodyStrong' : 'headline'}>{s.allDone}</Text>
        </View>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {next?.dueAt != null ? s.nextUp(next.title, dueText(next.dueAt, now, locale)) : s.nothingToday}
        </Text>
      </View>
    );
  } else if (size === 'sm') {
    const first = items[0];
    body = (
      <View style={{ gap: t.spacing.xxs }}>
        <Text variant="micro" tone="faint">
          {s.label}
        </Text>
        <View style={[styles.row, { gap: t.spacing.sm, alignItems: 'baseline' }]}>
          <Text variant="numberL">{items.length}</Text>
          {overdue ? (
            <Text variant="caption" tone="down">
              {s.overdueCount(overdue)}
            </Text>
          ) : null}
        </View>
        <View style={[styles.row, { gap: t.spacing.xs }]}>
          {first.priority === 'high' ? <Icon name="flag" size={12} color={t.colors.warn} /> : null}
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
            {first.title}
          </Text>
        </View>
      </View>
    );
  } else {
    const shown = items.slice(0, 4);
    body = (
      <View style={{ gap: t.spacing.xxs }}>
        {shown.map((x) => (
          <Row key={x.id} host={host} todo={x} now={now} onDone={() => complete(x)} />
        ))}
        {items.length > shown.length ? (
          <Text variant="micro" tone="faint" style={{ paddingLeft: t.spacing.xs }}>
            {s.more(items.length - shown.length)}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Pressable accessibilityRole="button" accessibilityLabel={s.openSchedule} accessibilityHint={items.length ? s.dueCount(items.length) : s.allDone} haptic={false} scaleTo={1} onPress={() => host.navigate('/schedule')}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
