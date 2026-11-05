import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { budgetStatus, byCategory, change, foldShares, groupByDay, inRange, series, totals } from '../aggregate';
import { strings } from '../strings';
import { addMonths, formatMoney, monthBounds, monthKey, MONTH_RE } from '../time';
import { useLedger } from '../use-ledger';
import { BudgetBar, Card, dayTitle, EntryRow, Money, monthTitle, pct, Switcher } from '../ui/parts';

/** Days of the list rendered at first; more on demand (a busy month has hundreds of rows). */
const DAYS_PAGE = 10;

/**
 * 记账 home: one month at a time. Totals and pace up top, then the budget, where the money went
 * (donut + legend), spending per day, and every entry grouped by day. Tap an entry to edit it.
 */
export function HomeScreen({ host, kv, params }: PluginScreenProps) {
  const { Screen, IconButton, Text, DonutChart, Legend, ColumnChart, EmptyState, Button, ListGroup, ListRow, Segmented, Chip } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(60_000).getTime();
  const current = monthKey(now);
  const [month, setMonth] = useState(params.month && MONTH_RE.test(params.month) && params.month <= current ? params.month : current);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [days, setDays] = useState(DAYS_PAGE);
  // Load the previous month too, for "vs same time last month".
  const prev = addMonths(month, -1);
  const { start, end } = monthBounds(month);
  const data = useLedger(kv, monthBounds(prev).start, end);

  const go = (n: number) => {
    host.haptics.select();
    setMonth((m) => addMonths(m, n));
    setDays(DAYS_PAGE);
  };
  const add = () => host.navigate(`/m/ledger/add${month !== current ? `?month=${month}` : ''}`);
  const trailing = (
    <View style={{ flexDirection: 'row', gap: t.spacing.xs }}>
      <IconButton icon="chart" label={s.yearView} variant="ghost" onPress={() => host.navigate(`/p/ledger/year?year=${month.slice(0, 4)}`)} />
      <IconButton icon="plus" label={s.add} variant="primary" onPress={add} />
    </View>
  );

  if (!data)
    return (
      <Screen title={s.title} back trailing={trailing}>
        <View />
      </Screen>
    );

  const { settings } = data;
  const entries = inRange(data.entries, { start, end });
  const sum = totals(entries);
  const ongoing = month === current;
  const prevStart = monthBounds(prev).start;
  // Same elapsed span of last month (whole last month for a past month).
  const before = totals(inRange(data.entries, { start: prevStart, end: ongoing ? Math.min(prevStart + (now - start), start) : start }));
  const delta = pct(change(sum.expense, before.expense));
  const budget = budgetStatus(entries, month, settings, now, locale).lines.find((l) => l.scope === 'total');
  const shares = foldShares(byCategory(entries, kind, settings.categories, locale), 6, s.others);
  const daily = series(entries, { start, end: ongoing ? Math.min(end, now + 1) : end, label: month, unit: 'day' });
  const groups = groupByDay(entries);
  const kindTotal = kind === 'expense' ? sum.expense : sum.income;

  return (
    <Screen title={s.title} back trailing={trailing}>
      <View style={{ gap: t.spacing.lg }}>
        <Switcher host={host} label={monthTitle(month, s)} onPrev={() => go(-1)} onNext={() => go(1)} canNext={month < current} prevLabel={s.prevMonth} nextLabel={s.nextMonth} />

        <Card host={host} index={0}>
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="caption" tone="muted">
              {ongoing ? s.monthExpense : s.expenseOf(monthTitle(month, s))}
            </Text>
            <Money host={host} value={sum.expense} />
          </View>
          <View style={{ flexDirection: 'row', gap: t.spacing.xl }}>
            <Figure host={host} label={s.income} value={sum.income} tone="up" />
            <Figure host={host} label={s.net} value={sum.net} />
          </View>
          {delta && before.expense > 0 ? <Chip label={s.vsLast(delta)} tone={sum.expense > before.expense ? 'warn' : 'up'} icon={sum.expense > before.expense ? 'trendUp' : 'trendDown'} /> : null}
        </Card>

        {budget ? (
          <Card host={host} index={1} title={s.budget} onPress={() => host.navigate('/m/ledger/budget')} trailing={<Text variant="caption" tone="muted">{s.budgetUsed(Math.round(budget.percent * 100))}</Text>}>
            <BudgetBar host={host} percent={budget.percent} elapsed={ongoing ? budget.elapsed : 0} status={budget.status} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.sm }}>
              <Text variant="caption" tone={budget.status === 'over' ? 'down' : 'muted'}>
                {budget.remaining >= 0 ? s.budgetLeft(formatMoney(budget.remaining)) : s.budgetOver(formatMoney(-budget.remaining))}
                {` / ¥${formatMoney(budget.budget, 0)}`}
              </Text>
              {ongoing && budget.perDayLeft > 0 ? (
                <Text variant="caption" tone="muted">
                  {s.perDay(formatMoney(budget.perDayLeft))}
                </Text>
              ) : null}
            </View>
            {ongoing && budget.status === 'ahead' ? (
              <Text variant="caption" tone="warn">
                {s.projected(formatMoney(budget.projected, 0))}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {entries.length === 0 ? (
          <EmptyState icon="ledger" title={s.noEntries} message={s.noEntriesHint} action={<Button title={s.add} icon="plus" onPress={add} />} />
        ) : (
          <>
            <Card host={host} index={2} title={s.byCategory} trailing={<View style={{ width: 150 }}><Segmented options={[{ label: s.expense, value: 'expense' }, { label: s.income, value: 'income' }]} value={kind} onChange={(v) => setKind(v as 'expense' | 'income')} /></View>}>
              {shares.length ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
                  <DonutChart
                    key={`${month}-${kind}`}
                    data={shares.map((c) => ({ label: c.name, value: c.amount }))}
                    size={136}
                    centerLabel={`¥${formatMoney(kindTotal, 0)}`}
                    centerCaption={kind === 'expense' ? s.expense : s.income}
                    valuePrefix="¥"
                    decimals={2}
                  />
                  <View style={{ flex: 1 }}>
                    <Legend columns items={shares.map((c) => ({ label: c.name, value: `${Math.round(c.share * 100)}%` }))} />
                  </View>
                </View>
              ) : (
                <Text variant="caption" tone="faint">
                  {kind === 'expense' ? s.noEntries : '—'}
                </Text>
              )}
            </Card>

            <Card host={host} index={3} title={s.daily}>
              <ColumnChart
                key={month}
                data={daily.map((d) => {
                  const [, m, day] = d.key.split('-').map(Number);
                  return { label: s.dayShort(m, day), value: d.expense };
                })}
                valuePrefix="¥"
                decimals={2}
                height={96}
              />
            </Card>

            <View style={{ gap: t.spacing.md }}>
              {groups.slice(0, days).map((g) => (
                <ListGroup key={g.day} title={`${dayTitle(g.day, s, locale)}${g.totals.expense ? ` · ${s.dayTotal(formatMoney(g.totals.expense))}` : ''}`}>
                  <View style={{ paddingHorizontal: t.spacing.md }}>
                    {g.entries.map((e) => (
                      <EntryRow key={e.id} host={host} entry={e} settings={settings} s={s} onPress={() => host.navigate(`/m/ledger/add?id=${encodeURIComponent(e.id)}`)} />
                    ))}
                  </View>
                </ListGroup>
              ))}
              {groups.length > days ? <Button title={`${s.more} (${groups.length - days})`} variant="ghost" onPress={() => setDays((d) => d + DAYS_PAGE)} /> : null}
            </View>
          </>
        )}

        <ListGroup title={s.more} footer={s.privacy}>
          {budget ? null : <ListRow icon="gauge" title={s.setBudget} chevron onPress={() => host.navigate('/m/ledger/budget')} />}
          <ListRow icon="chart" title={s.yearView} chevron onPress={() => host.navigate(`/p/ledger/year?year=${month.slice(0, 4)}`)} />
          <ListRow icon="palette" title={s.categories} chevron onPress={() => host.navigate('/p/ledger/categories')} />
          <ListRow icon="card" title={s.importCard} subtitle={s.importCardHint} chevron onPress={() => host.ask(s.importCardPrompt)} />
          <ListRow icon="sparkles" title={s.askWhere} chevron onPress={() => host.ask(s.askWherePrompt)} />
        </ListGroup>
      </View>
    </Screen>
  );
}

function Figure({ host, label, value, tone }: { host: PluginScreenProps['host']; label: string; value: number; tone?: 'up' }) {
  const { Text } = host.components;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="micro" tone="faint">
        {label}
      </Text>
      <Text variant="numberM" tone={tone ?? 'default'}>
        {`${value < 0 ? '−' : ''}¥${formatMoney(Math.abs(value))}`}
      </Text>
    </View>
  );
}
