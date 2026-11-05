import type { PluginScreenProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { CATEGORY_ICONS, categoryName, OTHER, type EntryType } from '../model';
import { strings } from '../strings';
import { useSettings } from '../use-ledger';

/** 分类管理: show / hide, rename, add. Every change goes through `ledger.categoryEdit`. */
export function CategoriesScreen({ host, kv, invoke }: PluginScreenProps) {
  const { Screen, Segmented, ListGroup, ListRow, Switch, Field, Button, Text, Pressable, Icon } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const settings = useSettings(kv);
  const [type, setType] = useState<EntryType>('expense');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState('');
  const [icon, setIcon] = useState('more');
  const [error, setError] = useState<string | null>(null);

  const run = async (input: Record<string, unknown>) => {
    setError(null);
    try {
      await invoke('ledger.categoryEdit', input);
      host.haptics.select();
      return true;
    } catch (e) {
      host.haptics.warning();
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const list = (settings?.categories ?? []).filter((c) => c.type === type);

  return (
    <Screen title={s.categories} back>
      <View style={{ gap: t.spacing.lg }}>
        <Segmented
          options={[{ label: s.expense, value: 'expense' }, { label: s.income, value: 'income' }]}
          value={type}
          onChange={(v) => {
            setType(v as EntryType);
            setEditing(null);
          }}
        />
        <ListGroup footer={s.categoriesFooter}>
          {list.map((c) =>
            editing === c.id ? (
              <View key={c.id} style={{ padding: t.spacing.md, gap: t.spacing.sm }}>
                <Field label={s.rename} value={name} onChangeText={setName} autoFocus />
                <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                  <Button title={s.save} size="sm" disabled={!name.trim()} onPress={() => void run({ action: 'rename', category: c.id, name: name.trim() }).then((ok) => ok && setEditing(null))} />
                  <Button title={s.cancel} size="sm" variant="ghost" onPress={() => setEditing(null)} />
                </View>
              </View>
            ) : (
              <ListRow
                key={c.id}
                icon={c.icon}
                title={categoryName(c, locale)}
                onPress={() => {
                  setEditing(c.id);
                  setName(categoryName(c, locale));
                }}
                accessory={c.id === OTHER[c.type] ? undefined : <Switch value={!c.hidden} onValueChange={(on) => void run({ action: on ? 'show' : 'hide', category: c.id })} label={s.shown} />}
              />
            ),
          )}
        </ListGroup>

        <ListGroup title={s.newCategory}>
          <View style={{ padding: t.spacing.md, gap: t.spacing.md }}>
            <Field label={s.newCategoryName} value={fresh} onChangeText={(v) => setFresh(v.slice(0, 8))} />
            <Text variant="caption" tone="muted">
              {s.icon}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
              {CATEGORY_ICONS.map((i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={i}
                  onPress={() => setIcon(i)}
                  style={{ width: 40, height: 40, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: icon === i ? t.colors.accentMuted : t.colors.surface2 }}>
                  <Icon name={i} size={18} color={icon === i ? t.colors.accent : t.colors.textMuted} />
                </Pressable>
              ))}
            </View>
            <Button
              title={s.addCategory}
              icon="plus"
              disabled={!fresh.trim()}
              onPress={() =>
                void run({ action: 'add', name: fresh.trim(), type, icon }).then((ok) => {
                  if (ok) setFresh('');
                })
              }
            />
          </View>
        </ListGroup>
        {error ? (
          <Text variant="callout" tone="down">
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
