import type { LiveData, PluginWidgetProps } from '@pku-harness/sdk';
import { useState } from 'react';
import { View } from 'react-native';

type Gpa = { status: 'ok'; overallGpa: number | null; totalCredits: number | null } | { status: 'verification_required'; message: string };

/** Overall GPA, hidden until tapped (grades are private; the dashboard may be seen by others). */
export function GpaWidget(props: PluginWidgetProps) {
  const { host, services } = props;
  const { Text, Button } = host.components;
  const t = host.useTheme();
  if (!services.campus.status().signedIn)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          登录校园账号后显示绩点
        </Text>
        <Button title="登录" size="sm" variant="secondary" icon="person" onPress={() => host.navigate('/campus')} style={{ alignSelf: 'flex-start' }} />
      </View>
    );
  return <Live {...props} />;
}

function Live({ host, size }: PluginWidgetProps) {
  const { Text, Skeleton, Button, IconButton } = host.components;
  const t = host.useTheme();
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
          {v?.status === 'verification_required' ? '查看成绩需要验证' : (data.error ?? '没有数据')}
        </Text>
        {v?.status === 'verification_required' ? (
          <Button title="去验证" size="sm" variant="secondary" icon="lock" onPress={() => host.ask('帮我查一下总绩点')} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <Button title="重试" size="sm" variant="secondary" icon="refresh" loading={data.fetching} onPress={() => void data.refresh()} style={{ alignSelf: 'flex-start' }} />
        )}
      </View>
    );
  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="micro" tone="faint">
          总绩点
        </Text>
        <IconButton icon="eye" label={shown ? '隐藏绩点' : '显示绩点'} variant="ghost" size={16} onPress={() => setShown((s) => !s)} />
      </View>
      <Text variant={size === 'md' ? 'numberL' : 'numberM'}>{shown ? (v.overallGpa?.toFixed(3) ?? '—') : '•.•••'}</Text>
      {size === 'md' && shown && v.totalCredits != null ? (
        <Text variant="caption" tone="muted">
          已修 {v.totalCredits} 学分
        </Text>
      ) : null}
    </View>
  );
}
