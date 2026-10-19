import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { CodeDigits, CopyArea, secondsLeft, useOtp } from './code';

const SCREEN = '/p/authenticator/home';

/** Dashboard widget: the current 手机令牌 code, big, with the hourglass draining to the next one. */
export function CodeWidget({ host, services, size }: PluginWidgetProps) {
  const { Text, Button, Skeleton, Hourglass } = host.components;
  const t = host.useTheme();
  const now = host.useNow(1000);
  const { otp } = useOtp(services);

  if (!services.campus.status().signedIn || otp === null)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {services.campus.status().signedIn ? '还没有绑定手机令牌' : '登录校园账号后可绑定手机令牌'}
        </Text>
        <Button
          title={services.campus.status().signedIn ? '去绑定' : '登录'}
          size="sm"
          variant="secondary"
          icon="key"
          onPress={() => host.navigate(services.campus.status().signedIn ? SCREEN : '/campus')}
          style={{ alignSelf: 'flex-start' }}
        />
      </View>
    );
  if (otp === undefined)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Skeleton width="70%" height={size === 'sm' ? 30 : 46} />
        <Skeleton width="35%" height={12} />
      </View>
    );

  const left = secondsLeft(now.getTime());
  const soon = left <= 5;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
      <Hourglass period={30} size={size === 'sm' ? 36 : 56} tone={soon ? 'warn' : 'accent'} />
      <View style={{ flex: 1, gap: t.spacing.xxs }}>
        {size === 'sm' ? (
          <Text variant="micro" tone="faint">
            手机令牌
          </Text>
        ) : null}
        <CopyArea host={host} code={otp.code}>
          <CodeDigits host={host} code={otp.code} variant={size === 'sm' ? 'numberL' : 'numberXL'} />
        </CopyArea>
        {size !== 'sm' ? (
          <Text variant="caption" tone={soon ? 'warn' : 'muted'}>
            {left} 秒后更新
          </Text>
        ) : null}
      </View>
    </View>
  );
}
