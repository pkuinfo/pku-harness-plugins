import { describeTrigger, formatLocal, type HostServices, type HostUI, type Job } from '@pku-harness/sdk';
import { StyleSheet, View } from 'react-native';

import { form } from './util';

function ReminderRow({ host, services, job }: { host: HostUI; services: HostServices; job: Job }) {
  const { Text, Icon, Switch, Pressable } = host.components;
  const t = host.useTheme();
  const finished = job.nextRunAt == null;
  const check = job.action.type === 'check';
  const next = job.enabled && job.nextRunAt ? `下次 ${formatLocal(job.nextRunAt).slice(5, 16)}` : finished ? `已结束 · 共 ${job.runs} 次` : '已暂停';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`编辑提醒 ${job.title}`}
      scaleTo={0.99}
      haptic={false}
      onPress={() => host.navigate(form('reminder', { id: job.id }))}
      style={[styles.row, { gap: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md }]}>
      <View style={[styles.icon, { backgroundColor: check ? t.colors.infoMuted : t.colors.accentMuted, borderRadius: t.radius.sm }]}>
        <Icon name={check ? 'refresh' : 'bell'} size={16} color={check ? t.colors.info : t.colors.accent} />
      </View>
      <View style={{ flex: 1, gap: t.spacing.xxs }}>
        <Text variant="body" numberOfLines={1} tone={job.enabled && !finished ? 'default' : 'faint'}>
          {job.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {describeTrigger(job.trigger)} · {next}
        </Text>
        {job.lastError ? (
          <Text variant="caption" tone="warn" numberOfLines={1}>
            上次检查失败：{job.lastError}
          </Text>
        ) : null}
      </View>
      {finished ? null : (
        <Switch
          label={`启用 ${job.title}`}
          value={job.enabled}
          onValueChange={(v) => {
            host.haptics.tap();
            services.scheduler.update(job.id, { enabled: v });
          }}
        />
      )}
    </Pressable>
  );
}

/** Stand-alone reminders and checks (to-do and class reminders live with their owners). */
export function ReminderList({ host, services, jobs }: { host: HostUI; services: HostServices; jobs: Job[] }) {
  const t = host.useTheme();
  return (
    <View style={[styles.group, { backgroundColor: t.colors.surface, borderRadius: t.radius.lg }]}>
      {jobs.map((j, i) => (
        <View key={j.id} style={i > 0 ? { borderTopColor: t.colors.border, borderTopWidth: StyleSheet.hairlineWidth } : undefined}>
          <ReminderRow host={host} services={services} job={j} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderCurve: 'continuous', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 60 },
  icon: { width: 32, height: 32, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
