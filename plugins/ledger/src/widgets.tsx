import { at, parts, type PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { budgetStatus, byCategory, inRange, series, totals } from './aggregate';
import { strings } from './strings';
import { dayKey, formatMoney, monthBounds, monthKey, sumYuan } from './time';
import { useLedger } from './use-ledger';
import { Money } from './ui/parts';

const open = (host: PluginWidgetProps['host']) => () => host.navigate('/p/ledger/home');

/**
 * 本月支出. sm: the month's spending, with a ring against the budget when one is set. md: the
 * spending, budget or income line, a small donut of categories and the top category.
 */
export function MonthWidget({ host, kv, size }: PluginWidgetProps) {
  const { Text, Ring, DonutChart, Pressable, Button } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(60_000).getTime();
  const m = monthKey(now);
  const { start, end } = monthBounds(m);
  const data = useLedger(kv, start, end);
  if (!data) return <View style={{ minHeight: 48 }} />;
  const entries = inRange(data.entries, { start, end });
  const sum = totals(entries);
  const budget = budgetStatus(entries, m, data.settings, now, locale).lines.find((l) => l.scope === 'total');
  const tone = budget?.status === 'over' ? 'down' : budget?.status === 'ahead' ? 'warn' : 'accent';

  if (!entries.length)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {s.widgetEmpty}
        </Text>
        <Button title={s.widgetAdd} size="sm" icon="plus" variant="secondary" onPress={() => host.navigate('/m/ledger/add')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );

  if (size === 'sm')
    return (
      <Pressable onPress={open(host)} accessibilityRole="button" accessibilityLabel={`${s.monthExpense} ¥${formatMoney(sum.expense)}`} haptic={false} scaleTo={0.98}>
        <View style={{ gap: t.spacing.xs }}>
          <Text variant="micro" tone="faint">
            {s.monthExpense}
          </Text>
          {budget ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Ring value={Math.min(1, budget.percent)} size={52} tone={tone} label={`${Math.round(budget.percent * 100)}`} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>{`¥${formatMoney(sum.expense, 0)}`}</Text>
                <Text variant="micro" tone="faint" numberOfLines={1}>
                  {s.ofBudget(formatMoney(budget.budget, 0))}
                </Text>
              </View>
            </View>
          ) : (
            <Money host={host} value={sum.expense} variant="numberL" />
          )}
        </View>
      </Pressable>
    );

  const top = byCategory(entries, 'expense', data.settings.categories, locale);
  return (
    <Pressable onPress={open(host)} accessibilityRole="button" accessibilityLabel={`${s.monthExpense} ¥${formatMoney(sum.expense)}`} haptic={false} scaleTo={0.99}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
        <View style={{ flex: 1, gap: t.spacing.xs }}>
          <Text variant="micro" tone="faint">
            {s.monthExpense}
          </Text>
          <Money host={host} value={sum.expense} variant="numberL" tone={budget?.status === 'over' ? 'down' : 'default'} />
          <Text variant="caption" tone={budget && budget.status !== 'ok' ? (budget.status === 'over' ? 'down' : 'warn') : 'muted'} numberOfLines={1}>
            {budget
              ? budget.remaining >= 0
                ? `${s.budgetLeft(formatMoney(budget.remaining, 0))} · ${s.budgetUsed(Math.round(budget.percent * 100))}`
                : s.budgetOver(formatMoney(-budget.remaining, 0))
              : `${s.income} ¥${formatMoney(sum.income, 0)}`}
          </Text>
          {top[0] ? (
            <Text variant="caption" tone="faint" numberOfLines={1}>
              {s.topCategory(top[0].name, formatMoney(top[0].amount, 0))}
            </Text>
          ) : null}
        </View>
        {top.length ? <DonutChart data={top.slice(0, 6).map((c) => ({ label: c.name, value: c.amount }))} size={76} thickness={10} selectable={false} /> : null}
      </View>
    </Pressable>
  );
}

/** 近 30 天: daily spending as a line, with the 30-day total and daily average. */
export function TrendWidget({ host, kv }: PluginWidgetProps) {
  const { Text, LineChart } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(60_000);
  const today = parts(now.getTime());
  const end = at(today.year, today.month, today.day + 1);
  const start = at(today.year, today.month, today.day - 29);
  const data = useLedger(kv, start, end);
  if (!data) return <View style={{ minHeight: 96 }} />;
  const days = series(data.entries, { start, end, label: dayKey(start), unit: 'day' });
  const total = sumYuan(days.map((d) => d.expense));
  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {s.last30}
        </Text>
        <Text variant="caption" tone="faint" style={{ fontVariant: ['tabular-nums'] }}>
          {`¥${formatMoney(total, 0)} · ${s.avgPerDay(formatMoney(total / 30))}`}
        </Text>
      </View>
      <LineChart
        data={days.map((d) => {
          const [, m, day] = d.key.split('-').map(Number);
          return { label: s.dayShort(m, day), value: d.expense };
        })}
        valuePrefix="¥"
        decimals={2}
        height={72}
        readout={false}
      />
    </View>
  );
}
