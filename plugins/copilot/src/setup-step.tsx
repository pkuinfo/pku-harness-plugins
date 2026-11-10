import type { HostUI } from '@pku-harness/sdk';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SetupStepState } from './setup';

type Props = {
  host: HostUI;
  /** 1-based position and count, for the badge and the screen-reader label. */
  index: number;
  total: number;
  title: string;
  /** Short live status shown on the right: "Connected", "Needed", "Connecting…". */
  status: string;
  state: SetupStepState;
  /** The next thing to do: accent badge and status. */
  current: boolean;
  stepLabel: string;
  expanded: boolean;
  onToggle: () => void;
  /** Purpose and actions, shown while expanded. */
  children?: ReactNode;
};

/**
 * One row of Copilot's setup checklist: a status badge (number, check, warning), the title,
 * the live status, and on demand the explanation and the action that opens the system screen.
 */
export function SetupStep({ host, index, total, title, status, state, current, stepLabel, expanded, onToggle, children }: Props) {
  const { Text, Icon, Pressable } = host.components;
  const theme = host.useTheme();
  const size = theme.spacing.xl;
  const done = state === 'done';
  const attention = state === 'attention';
  const badgeFill = done ? theme.colors.upMuted : attention ? theme.colors.warnMuted : current ? theme.colors.accent : theme.colors.surface2;
  const statusTone = done ? 'up' : attention ? 'warn' : current ? 'accent' : 'muted';
  return (
    <View style={{ borderBottomWidth: index < total ? StyleSheet.hairlineWidth : 0, borderColor: theme.colors.border }}>
      <Pressable onPress={onToggle} haptic={false} scaleTo={1} accessibilityRole="button"
        accessibilityLabel={`${stepLabel}, ${title}, ${status}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.md, minHeight: theme.spacing.xxxl }}>
        <View style={{ width: size, height: size, borderRadius: theme.radius.full, backgroundColor: badgeFill, alignItems: 'center', justifyContent: 'center' }}>
          {done ? <Icon name="check" size={theme.spacing.md + theme.spacing.xxs} color={theme.colors.up} />
            : attention ? <Icon name="warning" size={theme.spacing.md + theme.spacing.xxs} color={theme.colors.warn} />
            : <Text variant="micro" tone={current ? 'onAccent' : 'muted'}>{index}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant={current ? 'bodyStrong' : 'body'} tone={done ? 'muted' : 'default'}>{title}</Text>
        </View>
        <Text variant="caption" tone={statusTone}>{status}</Text>
        <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={theme.spacing.lg} color={theme.colors.textFaint} />
      </Pressable>
      {expanded && children ? (
        <View style={{ gap: theme.spacing.md, paddingLeft: size + theme.spacing.md, paddingBottom: theme.spacing.lg }}>{children}</View>
      ) : null}
    </View>
  );
}
