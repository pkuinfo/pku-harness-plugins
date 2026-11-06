import { parts, type PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { byCategory, change, foldShares, inRange, series, totals } from '../aggregate';
import { strings } from '../strings';
import { formatMoney, resolvePeriod } from '../time';
import { useLedger } from '../use-ledger';
import { Card, Money, pct, Switcher } from '../ui/parts';

/** 年度报表: a year's totals, spending per month, net per month, categories, and every month as a row. */
export function YearScreen({ host, kv, params }: PluginScreenProps) {
  const { Screen, Text, ColumnChart, LineChart, DonutChart, Legend, ListGroup, ListRow, EmptyState, Chip } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(60_000);
  const thisYear = parts(now.getTime()).year;
  const asked = Number(params.year);
  const [year, setYear] = useState(Number.isInteger(asked) && asked > 1999 && asked <= thisYear ? asked : thisYear);
  const r = resolvePeriod({ period: 'year', year }, now.getTime());
  const last = resolvePeriod({ period: 'year', year: year - 1 }, now.getTime());
  const data = useLedger(kv, last.start, r.end);

  const go = (n: number) => {
    host.haptics.select();
    setYear((y) => y + n);
  };

  const body = () => {
    if (!data) return null;
    const entries = inRange(data.entries, r);
    if (!entries.length) return <EmptyState icon="chart" title={s.noEntriesYear} />;
    const sum = totals(entries);
    const before = totals(inRange(data.entries, last));
    const delta = year < thisYear ? pct(change(sum.expense, before.expense)) : null;
    const months = series(entries, r);
    const shares = foldShares(byCategory(entries, 'expense', data.settings.categories, locale), 6, s.others);
    const label = (key: string) => s.monthShort(Number(key.slice(5)));
    return (
      <>
        <Card host={host} index={0}>
          <Text variant="caption" tone="muted">
            {s.expenseOf(s.yearLabel(year))}
          </Text>
          <Money host={host} value={sum.expense} />
          <View style={{ flexDirection: 'row', gap: t.spacing.xl }}>
            <View style={{ gap: 2 }}>
              <Text variant="micro" tone="faint">
                {s.income}
              </Text>
              <Text variant="numberM" tone="up">{`¥${formatMoney(sum.income)}`}</Text>
            </View>
            <View style={{ gap: 2 }}>
              <Text variant="micro" tone="faint">
                {s.net}
              </Text>
              <Text variant="numberM">{`${sum.net < 0 ? '−' : ''}¥${formatMoney(Math.abs(sum.net))}`}</Text>
            </View>
          </View>
          {delta && before.expense > 0 ? <Chip label={s.vsLastYear(delta)} tone={sum.expense > before.expense ? 'warn' : 'up'} /> : null}
        </Card>
        <Card host={host} index={1} title={s.monthly}>
          <ColumnChart key={`c${year}`} data={months.map((m) => ({ label: label(m.key), value: m.expense }))} labels="all" valuePrefix="¥" decimals={2} />
        </Card>
        <Card host={host} index={2} title={s.monthlyNet}>
          <LineChart key={`l${year}`} data={months.map((m) => ({ label: label(m.key), value: Math.round((m.income - m.expense) * 100) / 100 }))} tone="info" labels="auto" valuePrefix="¥" decimals={2} height={96} />
        </Card>
        {shares.length ? (
          <Card host={host} index={3} title={s.byCategory}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
              <DonutChart key={`d${year}`} data={shares.map((c) => ({ label: c.name, value: c.amount }))} size={136} centerLabel={`¥${formatMoney(sum.expense, 0)}`} centerCaption={s.expense} valuePrefix="¥" decimals={2} />
              <View style={{ flex: 1 }}>
                <Legend columns items={shares.map((c) => ({ label: c.name, value: `${Math.round(c.share * 100)}%` }))} />
              </View>
            </View>
          </Card>
        ) : null}
        <ListGroup>
          {[...months].reverse().filter((m) => m.expense || m.income).map((m) => (
            <ListRow
              key={m.key}
              title={label(m.key)}
              subtitle={`${s.income} ¥${formatMoney(m.income)}`}
              value={`¥${formatMoney(m.expense)}`}
              chevron
              onPress={() => host.navigate(`/p/ledger/home?month=${m.key}`)}
            />
          ))}
        </ListGroup>
      </>
    );
  };

  return (
    <Screen title={s.yearView} back>
      <View style={{ gap: t.spacing.lg }}>
        <Switcher host={host} label={s.yearLabel(year)} onPrev={() => go(-1)} onNext={() => go(1)} canNext={year < thisYear} prevLabel={s.prevYear} nextLabel={s.nextYear} />
        {body()}
      </View>
    </Screen>
  );
}
