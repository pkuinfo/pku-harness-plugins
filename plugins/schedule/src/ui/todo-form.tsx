import { describeTrigger, type PluginScreenProps, type Trigger } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

type RemindMode = 'none' | 'atDue' | 'before15' | 'before60' | 'custom';
const MODES: { label: string; value: RemindMode }[] = [
  { label: '不提醒', value: 'none' },
  { label: '到期时', value: 'atDue' },
  { label: '提前15分', value: 'before15' },
  { label: '提前1时', value: 'before60' },
];

/** Create or edit a to-do: title, notes, due time, reminder. */
export function TodoForm({ host, services, params }: PluginScreenProps) {
  const { SheetScreen, Field, DateTimeField, Segmented, Text } = host.components;
  const t = host.useTheme();
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

  const remind = (): Trigger | null | undefined => {
    if (mode === 'custom') return undefined;
    if (mode === 'none' || !due) return null;
    const before = mode === 'before15' ? 15 : mode === 'before60' ? 60 : 0;
    return { type: 'at', at: due.getTime() - before * 60_000 };
  };

  const save = async () => {
    const dueAt = due ? due.getTime() : null;
    if (existing) await services.todos.update(existing.id, { title, notes, dueAt, remind: remind() }, 'user');
    else await services.todos.add({ title, notes, dueAt, remind: remind() }, 'user');
    host.haptics.success();
    host.dismiss('/schedule');
  };

  return (
    <SheetScreen
      title={existing ? '编辑待办' : '新待办'}
      primary="保存"
      onPrimary={save}
      primaryDisabled={!title.trim()}
      danger={existing ? '删除' : undefined}
      onDanger={async () => {
        host.haptics.warning();
        if (existing) await services.todos.remove(existing.id);
        host.dismiss('/schedule');
      }}>
      <Field label="内容" value={title} onChangeText={setTitle} placeholder="例如：交高数作业" autoFocus={!existing && !params.title} />
      <Field label="备注" value={notes} onChangeText={setNotes} placeholder="可选" multiline />
      <DateTimeField label="截止时间" value={due} onChange={setDue} onClear={() => setDue(null)} />
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="callout" tone="muted">
          提醒
        </Text>
        <Segmented options={hadCustom ? [...MODES, { label: '自定义', value: 'custom' }] : MODES} value={mode} onChange={(v) => setMode(v as RemindMode)} />
        {mode === 'custom' && job ? (
          <Text variant="caption" tone="muted">
            {describeTrigger(job.trigger)}（可在对话里让 AI 修改）
          </Text>
        ) : null}
        {mode !== 'none' && mode !== 'custom' && !due ? (
          <Text variant="caption" tone="warn">
            先设置截止时间才能提醒
          </Text>
        ) : null}
      </View>
    </SheetScreen>
  );
}
