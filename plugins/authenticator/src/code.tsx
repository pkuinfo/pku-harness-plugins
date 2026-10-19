import type { HostServices, HostUI, OtpCode } from '@pku-harness/sdk';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, View } from 'react-native';

/** TOTP window (RFC 6238 default; IAAA uses 30 s, pkucli otp.rs TOTP_PERIOD). */
export const PERIOD_MS = 30_000;

/**
 * The current code from the host, refetched exactly at each window boundary (Unix time / 30)
 * and when the app returns to the foreground. `undefined` while loading, `null` when not bound.
 */
export function useOtp(services: HostServices) {
  const [otp, setOtp] = useState<OtpCode | null | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      void services.campus
        .otp()
        .catch(() => null)
        .then((v) => {
          if (!alive) return;
          setOtp(v);
          clearTimeout(timer);
          // A few ms past the boundary so the host computes the new window's code.
          timer = setTimeout(tick, PERIOD_MS - (Date.now() % PERIOD_MS) + 15);
        });
    };
    tick();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
      else clearTimeout(timer);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      sub.remove();
    };
  }, [services, nonce]);
  /** Refetch now (e.g. right after binding). */
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { otp, refresh };
}

/** Seconds left in the current window, from the clock (not from the fetched value). */
export const secondsLeft = (now = Date.now()) => Math.ceil((PERIOD_MS - (now % PERIOD_MS)) / 1000);

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

type Variant = 'numberXL' | 'numberL' | 'numberM';

/**
 * "123 456" in tabular numerals. When the code changes, each digit is crushed out with a small
 * spark burst while the new one drops in, staggered left to right (~500 ms total); with reduced
 * motion it is a plain cross-fade.
 */
export function CodeDigits({ host, code, variant = 'numberXL', tone = 'default' }: { host: HostUI; code: string; variant?: Variant; tone?: 'default' | 'muted' }) {
  const t = host.useTheme();
  const reduced = useReducedMotion();
  const type = t.typography[variant] as { fontSize?: number; lineHeight?: number };
  const fontSize = type.fontSize ?? 28;
  const cell = { width: Math.round(fontSize * 0.64), height: type.lineHeight ?? fontSize * 1.2 };
  const chars = code.padEnd(6).slice(0, 6).split('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessible accessibilityLabel={`验证码 ${code.split('').join(' ')}`}>
      {chars.map((ch, i) => (
        <View key={i} style={{ flexDirection: 'row' }}>
          {i === 3 ? <View style={{ width: Math.round(fontSize * 0.36) }} /> : null}
          <Digit host={host} ch={ch} index={i} variant={variant} tone={tone} cell={cell} reduced={reduced} spark={t.colors.accent} />
        </View>
      ))}
    </View>
  );
}

const SPARKS = 7;
const STAGGER = 45;

function Digit({
  host,
  ch,
  index,
  variant,
  tone,
  cell,
  reduced,
  spark,
}: {
  host: HostUI;
  ch: string;
  index: number;
  variant: Variant;
  tone: 'default' | 'muted';
  cell: { width: number; height: number };
  reduced: boolean;
  spark: string;
}) {
  const { Text } = host.components;
  const [cur, setCur] = useState(ch);
  const [old, setOld] = useState<string | null>(null);
  const prev = useRef(ch);
  const [inV] = useState(() => new Animated.Value(1));
  const [outV] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (ch === prev.current) return;
    setOld(prev.current);
    setCur(ch);
    prev.current = ch;
    inV.setValue(0);
    outV.setValue(0);
    const delay = reduced ? 0 : index * STAGGER;
    const anim = Animated.parallel([
      Animated.timing(outV, { toValue: 1, duration: reduced ? 220 : 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(inV, { toValue: 1, duration: reduced ? 220 : 300, delay: reduced ? 0 : delay + 110, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
    ]);
    anim.start(({ finished }) => {
      if (finished) setOld(null);
    });
    return () => anim.stop();
  }, [ch, index, reduced, inV, outV]);

  const abs = { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center' as const, justifyContent: 'center' as const };
  const inStyle = reduced
    ? { opacity: inV }
    : {
        opacity: inV.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
        transform: [{ translateY: inV.interpolate({ inputRange: [0, 1], outputRange: [-cell.height * 0.35, 0] }) }, { scale: inV.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
      };
  const outStyle = reduced
    ? { opacity: outV.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }
    : {
        opacity: outV.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.5, 0] }),
        transform: [
          { translateY: outV.interpolate({ inputRange: [0, 1], outputRange: [0, cell.height * 0.18] }) },
          { scaleX: outV.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) },
          { scaleY: outV.interpolate({ inputRange: [0, 1], outputRange: [1, 0.15] }) },
        ],
      };
  const dot = Math.max(2, Math.round(cell.width * 0.12));
  const reach = cell.width * 0.9;

  return (
    <View style={cell}>
      {old != null ? (
        <Animated.View style={[abs, outStyle]} pointerEvents="none">
          <Text variant={variant} tone={tone}>
            {old}
          </Text>
        </Animated.View>
      ) : null}
      {old != null && !reduced
        ? Array.from({ length: SPARKS }, (_, k) => {
            const a = (k / SPARKS) * Math.PI * 2 + index;
            return (
              <Animated.View
                key={k}
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: cell.width / 2 - dot / 2,
                  top: cell.height / 2 - dot / 2,
                  width: dot,
                  height: dot,
                  borderRadius: dot,
                  backgroundColor: spark,
                  opacity: outV.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
                  transform: [
                    { translateX: outV.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * reach] }) },
                    { translateY: outV.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * reach + cell.height * 0.1] }) },
                    { scale: outV.interpolate({ inputRange: [0, 1], outputRange: [1.2, 0.3] }) },
                  ],
                }}
              />
            );
          })
        : null}
      <Animated.View style={[abs, inStyle]}>
        <Text variant={variant} tone={tone}>
          {cur}
        </Text>
      </Animated.View>
    </View>
  );
}

/** Tap target that copies the code when the host has a clipboard; otherwise just shows it. */
export function CopyArea({ host, code, children }: { host: HostUI; code: string | null; children: ReactNode }) {
  const { Pressable } = host.components;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const clip = host.clipboard;
  if (!clip || !code) return <>{children}</>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="复制验证码"
      haptic
      onPress={() => {
        void clip.setString(code).then(() => {
          host.haptics.success();
          setCopied(true);
        });
      }}
    >
      {children}
      <CopiedHint host={host} show={copied} />
    </Pressable>
  );
}

function CopiedHint({ host, show }: { host: HostUI; show: boolean }) {
  const { Text } = host.components;
  return (
    <Text variant="micro" tone={show ? 'up' : 'faint'}>
      {show ? '已复制' : '点按复制'}
    </Text>
  );
}
