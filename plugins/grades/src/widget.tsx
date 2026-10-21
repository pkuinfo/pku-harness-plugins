import type { LiveData, PluginWidgetProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

import { strings } from './strings';

type Gpa = { status: 'ok'; overallGpa: number | null; totalCredits: number | null } | { status: 'verification_required'; message: string };

/** Overall GPA, hidden until tapped (grades are private; the dashboard may be seen by others). */
export function GpaWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {s.signedOut}
        </Text>
        <Button title={s.signIn} size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button, IconButton } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const [shown, setShown] = useState(false);
  const data: LiveData<Gpa> = host.useToolData<Gpa>('grades.gpa', {}, { ttlMinutes: 12 * 60 });
  if (data.status === 'loading')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="45%" height={size === 'md' ? 30 : 26} />
        <Skeleton width="35%" height={12} />
      </View>
    );
  const v = data.value;
  if (!v || v.status !== 'ok')
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted" numberOfLines={3}>
          {v?.status === 'verification_required' ? s.verifyNeeded : (data.error ?? s.noData)}
        </Text>
        {v?.status === 'verification_required' ? (
          <Button title={s.verify} size="sm" variant="secondary" icon="lock" onPress={() => host.ask(s.askGpa)} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <Button title={s.retry} size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
        )}
      </View>
    );
  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="micro" tone="faint">
          {s.label}
        </Text>
        <IconButton icon="eye" label={shown ? s.hide : s.show} variant="ghost" size={16} onPress={() => setShown((s) => !s)} />
      </View>
      <Text variant={size === 'md' ? 'numberL' : 'numberM'}>{shown ? (v.overallGpa?.toFixed(3) ?? '—') : '•.•••'}</Text>
      {size === 'md' && shown && v.totalCredits != null ? (
        <Text variant="caption" tone="muted">
          {s.credits(v.totalCredits)}
        </Text>
      ) : null}
    </View>
  );
}
