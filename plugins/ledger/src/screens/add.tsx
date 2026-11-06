import { formatClock, type PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { amountOf, KEYS, pressKey, textOf, type Key } from '../keypad';
import { ACCOUNTS, accountName, categoryName, OTHER, type Entry, type EntryType } from '../model';
import { getEntry } from '../store';
import { strings } from '../strings';
import { dayKey, formatMoney, monthBounds, MONTH_RE } from '../time';
import { useSettings } from '../use-ledger';

const whenOf = (d: Date) => `${dayKey(d)} ${formatClock(d)}`;

/**
 * 记一笔 / edit. Fast path: the sheet opens on 支出 with the first category picked, so type the
 * amount on the keypad and tap 保存 (or tap a category first: three taps for "午饭 18"). Saving
 * runs the same `ledger.add` / `ledger.update` tools the agent uses. 「说一句」 hands off to chat.
 */
export function AddScreen({ host, kv, invoke, params }: PluginScreenProps) {
  const { SheetScreen, Segmented, Text, Pressable, Icon, Field, DateTimeField, Button } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const editId = params.id;
  const [existing, setExisting] = useState<Entry | null | undefined>(editId ? undefined : null);
  const [type, setType] = useState<EntryType>('expense');
  const [text, setText] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [account, setAccount] = useState<string | undefined>(undefined);
  const [note, setNote] = useState('');
  // A month param (adding from a past month on the home screen) starts on that month's last day.
  const [date, setDate] = useState(() => {
    if (params.month && MONTH_RE.test(params.month)) {
      const end = monthBounds(params.month).end;
      if (end < Date.now()) return new Date(end - 12 * 3600_000);
    }
    return new Date();
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const settings = useSettings(kv);

  useEffect(() => {
    if (!editId) return;
    let live = true;
    void getEntry(kv, editId).then((e) => {
      if (!live) return;
      setExisting(e);
      if (!e) return;
      setType(e.type);
      setText(textOf(e.amount));
      setCategory(e.category);
      setAccount(e.account);
      setNote(e.note ?? '');
      setDate(new Date(e.at));
    });
    return () => {
      live = false;
    };
  }, [kv, editId]);

  // New entries start on the type's first visible category.
  useEffect(() => {
    if (editId || category || !settings) return;
    setCategory(settings.categories.find((x) => x.type === type && !x.hidden)?.id ?? OTHER[type]);
  }, [editId, category, settings, type]);

  const cats = (settings?.categories ?? []).filter((c) => c.type === type && (!c.hidden || c.id === category));
  const amount = amountOf(text);
  const valid = amount > 0 && !!category && !busy;

  const switchType = (v: string) => {
    const next = v as EntryType;
    if (next === type) return;
    host.haptics.select();
    setType(next);
    setCategory(settings?.categories.find((x) => x.type === next && !x.hidden)?.id ?? OTHER[next]);
  };

  const press = (k: Key) => {
    host.haptics.tap();
    setText((cur) => pressKey(cur, k));
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      // A day other than today without a time change keeps the time the user had (edit) or noon.
      const sameDay = existing && dayKey(existing.at) === dayKey(date);
      const when = sameDay ? undefined : dayKey(date) === dayKey(Date.now()) ? whenOf(new Date()) : whenOf(date);
      const fields = { type, amount: Math.round(amount * 100) / 100, category: category!, note: note.trim() };
      if (existing) await invoke('ledger.update', { id: existing.id, ...fields, account: account ?? null, note: fields.note || null, ...(when ? { when } : {}) });
      else await invoke('ledger.add', { type, amount: fields.amount, category: fields.category, ...(fields.note ? { note: fields.note } : {}), ...(account ? { account } : {}), when: when ?? whenOf(date) });
      host.haptics.success();
      host.dismiss('/p/ledger/home');
    } catch (e) {
      host.haptics.warning();
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const del = async () => {
    if (!existing) return;
    if (!confirmDelete) {
      host.haptics.warning();
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await invoke('ledger.delete', { ids: [existing.id] });
      host.haptics.success();
      host.dismiss('/p/ledger/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const tone = type === 'income' ? 'up' : 'default';
  const picked = cats.find((c) => c.id === category);

  return (
    <SheetScreen
      title={editId ? s.edit : s.add}
      primary={amount > 0 ? `${s.save} · ¥${formatMoney(amount)}` : s.save}
      onPrimary={() => void save()}
      primaryDisabled={!valid || existing === undefined}
      loading={busy}
      danger={existing ? (confirmDelete ? s.deleteConfirm : s.delete) : undefined}
      onDanger={existing ? () => void del() : undefined}>
      <View style={{ gap: t.spacing.lg }}>
        <Segmented options={[{ label: s.expense, value: 'expense' }, { label: s.income, value: 'income' }]} value={type} onChange={switchType} />

        {/* The amount as typed, large; the picked category beside it. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: t.spacing.md }} accessible accessibilityLabel={`${s.amount} ¥${text || '0'}`}>
          <Text variant="callout" tone="muted" numberOfLines={1}>
            {picked ? categoryName(picked, locale) : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xs, flexShrink: 1 }}>
            <Text variant="numberL" tone={tone === 'up' ? 'up' : 'muted'}>
              {type === 'income' ? '+¥' : '¥'}
            </Text>
            <Text variant="numberXL" tone={text ? tone : 'faint'} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
              {text || '0'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.spacing.sm }}>
          {cats.map((c) => {
            const on = c.id === category;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={categoryName(c, locale)}
                onPress={() => {
                  host.haptics.select();
                  setCategory(c.id);
                }}
                style={{ width: '20%', alignItems: 'center', gap: t.spacing.xxs }}>
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: t.radius.full,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: on ? (type === 'income' ? t.colors.upMuted : t.colors.accentMuted) : t.colors.surface2,
                    borderWidth: 1,
                    borderColor: on ? (type === 'income' ? t.colors.up : t.colors.accent) : 'transparent',
                  }}>
                  <Icon name={c.icon} size={20} color={on ? (type === 'income' ? t.colors.up : t.colors.accent) : t.colors.textMuted} />
                </View>
                <Text variant="micro" tone={on ? 'default' : 'muted'} numberOfLines={1}>
                  {categoryName(c, locale)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Keypad host={host} onPress={press} label={s.key} />

        <Field label={s.note} value={note} onChangeText={setNote} placeholder={s.notePlaceholder} />
        <DateTimeField label={s.date} value={date} onChange={setDate} mode="date" />

        <View style={{ gap: t.spacing.xs }}>
          <Text variant="caption" tone="muted">
            {s.account}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
            {[undefined, ...ACCOUNTS].map((a) => {
              const on = account === a;
              return (
                <Pressable
                  key={a ?? 'none'}
                  accessibilityRole="button"
                  accessibilityLabel={accountName(a, locale) ?? s.unassigned}
                  onPress={() => setAccount(a)}
                  style={{
                    paddingHorizontal: t.spacing.md,
                    paddingVertical: t.spacing.xs,
                    borderRadius: t.radius.full,
                    borderWidth: 1,
                    borderColor: on ? t.colors.accent : t.colors.border,
                    backgroundColor: on ? t.colors.accentMuted : 'transparent',
                  }}>
                  <Text variant="caption" tone={on ? 'accent' : 'muted'}>
                    {accountName(a, locale) ?? s.unassigned}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {error ? (
          <Text variant="callout" tone="down">
            {error}
          </Text>
        ) : null}

        {editId ? null : (
          <View style={{ gap: t.spacing.xs, alignItems: 'flex-start' }}>
            <Button title={s.say} icon="sparkles" variant="secondary" size="sm" onPress={() => host.ask(s.sayPrompt)} />
            <Text variant="caption" tone="faint">
              {s.sayHint}
            </Text>
          </View>
        )}
      </View>
    </SheetScreen>
  );
}

/** 3 × 4 number pad: digits, decimal point, delete. */
function Keypad({ host, onPress, label }: { host: PluginScreenProps['host']; onPress: (k: Key) => void; label: (k: string) => string }) {
  const { Pressable, Text, Icon } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={label(k)}
          onPress={() => onPress(k)}
          haptic={false}
          scaleTo={0.94}
          style={{ flexBasis: '31%', flexGrow: 1, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: t.radius.lg, backgroundColor: t.colors.surface }}>
          {k === 'back' ? <Icon name="backspace" size={22} color={t.colors.textMuted} /> : <Text variant="numberM">{k}</Text>}
        </Pressable>
      ))}
    </View>
  );
}
