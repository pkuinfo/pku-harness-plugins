import type { PluginScreenProps } from '@pku-harness/sdk';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';

import { memoryChanged } from './events';
import { checkText, cleanText, MAX_TEXT } from './policy';
import { KINDS, type MemoryKind, type MemoryView } from './rank';
import { strings } from './strings';

const BACK = '/p/memory/memory';

/** Add a memory, or edit one's text, kind and pin (modal sheet; `params.id` = edit). */
export function EditMemoryScreen({ host, invoke, params }: PluginScreenProps) {
  const { SheetScreen, Field, Segmented, Switch, Text, EmptyState } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const id = params.id;
  const [existing, setExisting] = useState<MemoryView | null | undefined>(id ? undefined : null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<MemoryKind>('fact');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    invoke('memory.list')
      .then((r) => {
        if (!live) return;
        const m = (r as MemoryView[]).find((x) => x.id === id) ?? null;
        setExisting(m);
        if (m) {
          setText(m.text);
          setKind(m.kind);
          setPinned(m.pinned);
        }
      })
      .catch(() => live && setExisting(null));
    return () => {
      live = false;
    };
  }, [id, invoke]);

  const length = [...cleanText(text)].length;
  const done = () => {
    memoryChanged();
    host.dismiss(BACK);
  };

  const save = async () => {
    const checked = checkText(text);
    if (!checked.ok) {
      host.haptics.warning();
      return setError(s.errors[checked.reason]);
    }
    setBusy(true);
    try {
      const r = (existing
        ? await invoke('memory.update', { id: existing.id, text: checked.text, kind, pinned })
        : await invoke('memory.remember', { text: checked.text, kind, pinned })) as { status: string };
      if (r.status === 'exists') {
        host.haptics.warning();
        return setError(s.errors.exists);
      }
      host.haptics.success();
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert(s.deleteTitle, s.deleteBody, [
      { text: s.cancel, style: 'cancel' },
      {
        text: s.delete,
        style: 'destructive',
        onPress: () => {
          if (!existing) return;
          host.haptics.warning();
          invoke('memory.forget', { id: existing.id })
            .catch(() => undefined)
            .finally(done);
        },
      },
    ]);

  if (id && existing === null) {
    return (
      <SheetScreen title={s.editTitle} primary={s.cancel} onPrimary={() => host.dismiss(BACK)}>
        <EmptyState icon="warning" title={s.notFound} />
      </SheetScreen>
    );
  }

  return (
    <SheetScreen
      title={existing ? s.editTitle : s.newTitle}
      primary={s.save}
      onPrimary={save}
      primaryDisabled={length < 2 || existing === undefined}
      loading={busy}
      danger={existing ? s.delete : undefined}
      onDanger={existing ? remove : undefined}>
      {existing?.status === 'pending' ? (
        <Text variant="callout" tone="warn">
          {s.pendingNote}
        </Text>
      ) : null}
      <Field
        label={s.text}
        value={text}
        onChangeText={(v) => {
          setText(v);
          setError(null);
        }}
        placeholder={s.textPlaceholder}
        hint={s.textHint(length, MAX_TEXT)}
        multiline
        autoFocus={!id}
      />
      {error ? (
        <Text variant="caption" tone="down">
          {error}
        </Text>
      ) : null}
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          {s.kind}
        </Text>
        <Segmented options={KINDS.map((k) => ({ label: s.kindOptions[k], value: k }))} value={kind} onChange={(v) => setKind(v as MemoryKind)} />
      </View>
      <Switch value={pinned} onValueChange={setPinned} label={s.pinLabel} />
    </SheetScreen>
  );
}
