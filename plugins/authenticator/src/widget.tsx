import type { HostUI, PluginWidgetProps } from '@pku-harness/sdk';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, View } from 'react-native';

import { CodeDigits, CopyArea, secondsLeft, useOtp } from './code';
import { strings } from './strings';

const SCREEN = '/p/authenticator/home';
/** A revealed code turns face down again after this long, or when the app leaves the screen. */
const SHOW_MS = 60_000;
/** Each half of the flip (to edge-on, then back to flat). */
const HALF_MS = 190;

/**
 * Dashboard widget: the current 手机令牌 code. Face down by default (title and masked digits);
 * a tap flips the card over to the code, with the hourglass draining to the next one. It turns
 * back after a minute or when the app goes to the background.
 */
export function CodeWidget({ host, services, size }: PluginWidgetProps) {
  const { Text, Button, Skeleton } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  const { otp } = useOtp(services);
  const signedIn = services.campus.status().signedIn;

  if (!signedIn || otp === null)
    return (
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="caption" tone="muted">
          {signedIn ? s.notBound : s.signedOut}
        </Text>
        <Button
          title={signedIn ? s.bindNow : s.signIn}
          size="sm"
          variant="secondary"
          icon="key"
          onPress={() => host.navigate(signedIn ? SCREEN : '/campus')}
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
  return <FlipCard host={host} size={size} code={otp.code} />;
}

function FlipCard({ host, size, code }: { host: HostUI; size: PluginWidgetProps['size']; code: string }) {
  const [shown, setShown] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const busy = useRef(false);

  // Turn over: to edge-on (ease in), swap the face, back to flat (ease out). Reduced motion fades.
  const flip = (next: boolean) => {
    if (busy.current) return;
    busy.current = true;
    Animated.timing(turn, { toValue: 1, duration: HALF_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
      setShown(next);
      Animated.timing(turn, { toValue: 0, duration: HALF_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => {
        busy.current = false;
      });
    });
  };

  // Face down again after a while, and right away when the app is backgrounded.
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => flip(false), SHOW_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        turn.setValue(0);
        setShown(false);
      }
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const style = reduced
    ? { opacity: turn.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }
    : { transform: [{ perspective: 800 }, { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '90deg'] }) }] };
  return (
    <Animated.View style={style}>
      {shown ? <CodeFace host={host} size={size} code={code} /> : <CoverFace host={host} size={size} onReveal={() => {
        host.haptics.tap();
        flip(true);
      }} />}
    </Animated.View>
  );
}

/** Face down: masked digits in the code's place, and how to see it. */
function CoverFace({ host, size, onReveal }: { host: HostUI; size: PluginWidgetProps['size']; onReveal: () => void }) {
  const { Text, Icon, Pressable } = host.components;
  const t = host.useTheme();
  const s = strings[host.useLocale()];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={s.reveal} onPress={onReveal}>
      <Row host={host} lead={<Icon name="lock" size={size === 'sm' ? 22 : 30} color={t.colors.textMuted} />} size={size}>
        {size === 'sm' ? (
          <Text variant="micro" tone="faint">
            {s.title}
          </Text>
        ) : null}
        <Text variant={size === 'sm' ? 'numberL' : 'numberXL'} tone="faint">
          ••• •••
        </Text>
        {/* The same lines as the code face (its "Tap to copy" and countdown), so the card keeps its height when it turns. */}
        <Text variant="micro" tone="faint">
          {size === 'sm' ? s.tapToReveal : s.hidden}
        </Text>
        {size !== 'sm' ? (
          <Text variant="caption" tone="muted">
            {s.tapToReveal}
          </Text>
        ) : null}
      </Row>
    </Pressable>
  );
}

/** Face up: the code (tap to copy) with the hourglass draining to the next one. */
function CodeFace({ host, size, code }: { host: HostUI; size: PluginWidgetProps['size']; code: string }) {
  const { Text, Hourglass } = host.components;
  const s = strings[host.useLocale()];
  const now = host.useNow(1000);
  const left = secondsLeft(now.getTime());
  const soon = left <= 5;
  return (
    <Row host={host} lead={<Hourglass period={30} size={size === 'sm' ? 36 : 56} tone={soon ? 'warn' : 'accent'} />} size={size}>
      {size === 'sm' ? (
        <Text variant="micro" tone="faint">
          {s.title}
        </Text>
      ) : null}
      <CopyArea host={host} code={code}>
        <CodeDigits host={host} code={code} variant={size === 'sm' ? 'numberL' : 'numberXL'} />
      </CopyArea>
      {size !== 'sm' ? (
        <Text variant="caption" tone={soon ? 'warn' : 'muted'}>
          {s.updatesIn(left)}
        </Text>
      ) : null}
    </Row>
  );
}

/** The shared layout of both faces: a square lead (lock or hourglass) and a text column. */
function Row({ host, lead, size, children }: { host: HostUI; lead: ReactNode; size: PluginWidgetProps['size']; children: ReactNode }) {
  const t = host.useTheme();
  const side = size === 'sm' ? 36 : 56;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
      <View style={{ width: side, height: side, alignItems: 'center', justifyContent: 'center' }}>{lead}</View>
      <View style={{ flex: 1, gap: t.spacing.xxs }}>{children}</View>
    </View>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}
