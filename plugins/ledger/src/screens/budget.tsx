import type { PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { categoryName } from '../model';
import { strings } from '../strings';
import { useSettings } from '../use-ledger';

const clean = (v: string) => {
  const m = /^\d{0,7}(\.\d{0,2})?/.exec(v.replace(/[^\d.]/g, ''));
  return m ? m[0] : '';
};
const num = (v: string) => (v && Number(v) > 0 ? Math.round(Number(v) * 100) / 100 : null);
const str = (v: number | undefined) => (v ? String(v) : '');

/** 月预算: a monthly total and optional per-category limits, saved through `ledger.budgetSet`. */
export function BudgetScreen({ host, kv, invoke }: PluginScreenProps) {
  const { SheetScreen, Field, Text } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const settings = useSettings(kv);
  const [total, setTotal] = useState('');
  const [cats, setCats] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings || loaded) return;
    setTotal(str(settings.budgets.total));
    setCats(Object.fromEntries(Object.entries(settings.budgets.categories).map(([k, v]) => [k, str(v)])));
    setLoaded(true);
  }, [settings, loaded]);

  const expense = (settings?.categories ?? []).filter((c) => c.type === 'expense' && (!c.hidden || settings?.budgets.categories[c.id]));

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setError(null);
    try {
      if (num(total) !== (settings.budgets.total ?? null)) await invoke('ledger.budgetSet', { total: num(total) });
      for (const c of expense) {
        const next = num(cats[c.id] ?? '');
        if (next !== (settings.budgets.categories[c.id] ?? null)) await invoke('ledger.budgetSet', { category: c.id, amount: next });
      }
      host.haptics.success();
      host.dismiss('/p/ledger/home');
    } catch (e) {
      host.haptics.warning();
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <SheetScreen title={s.budgetTitle} primary={s.save} onPrimary={() => void save()} primaryDisabled={!loaded} loading={busy}>
      <View style={{ gap: t.spacing.lg }}>
        <Field label={s.budgetTotal} value={total} onChangeText={(v) => setTotal(clean(v))} placeholder={s.budgetNone} keyboardType="decimal-pad" autoFocus={!settings?.budgets.total} />
        <Text variant="caption" tone="muted">
          {s.budgetByCategory}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {expense.map((c) => (
            <View key={c.id} style={{ flexBasis: '47%', flexGrow: 1 }}>
              <Field label={categoryName(c, locale)} value={cats[c.id] ?? ''} onChangeText={(v) => setCats((m) => ({ ...m, [c.id]: clean(v) }))} placeholder={s.budgetNone} keyboardType="decimal-pad" />
            </View>
          ))}
        </View>
        <Text variant="caption" tone="faint">
          {s.budgetFooter}
        </Text>
        {error ? (
          <Text variant="callout" tone="down">
            {error}
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}
