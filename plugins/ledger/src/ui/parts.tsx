import { formatWeekday, type AppLocale, type HostUI } from '@pku-harness/sdk';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { categoryName, accountName, type Entry, type Settings } from '../model';
import type { Strings } from '../strings';
import { formatMoney } from '../time';

/** Shared bits of the ledger's screens and widgets. */

export const monthTitle = (month: string, s: Strings) => {
  const [y, m] = month.split('-').map(Number);
  return s.monthLabel(y, m);
};

export const dayTitle = (day: string, s: Strings, locale: AppLocale) => {
  const [y, m, d] = day.split('-').map(Number);
  return `${s.dayShort(m, d)} ${formatWeekday(new Date(y, m - 1, d), locale)}`;
};

/** "+12%" / "-8%" / null. */
export const pct = (ratio: number | null) => (ratio == null ? null : `${ratio > 0 ? '+' : ratio < 0 ? '−' : ''}${Math.abs(Math.round(ratio * 100))}%`);

/** A glass card with a title row (and an optional trailing element). */
export function Card({ host, index = 0, title, trailing, children, onPress }: { host: HostUI; index?: number; title?: string; trailing?: ReactNode; children: ReactNode; onPress?: () => void }) {
  const { Glass, FadeIn, Text } = host.components;
  const t = host.useTheme();
  return (
    <FadeIn index={index}>
      <Glass radius={t.radius.xl} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={onPress ? title : undefined}>
        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          {title || trailing ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
              {title ? (
                <Text variant="bodyStrong" style={{ flex: 1 }}>
                  {title}
                </Text>
              ) : null}
              {trailing}
            </View>
          ) : null}
          {children}
        </View>
      </Glass>
    </FadeIn>
  );
}

/** Previous / label / next. `next` disabled past the current period. */
export function Switcher({ host, label, onPrev, onNext, canNext, prevLabel, nextLabel }: { host: HostUI; label: string; onPrev: () => void; onNext: () => void; canNext: boolean; prevLabel: string; nextLabel: string }) {
  const { IconButton, Text } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
      <IconButton icon="chevronLeft" label={prevLabel} variant="ghost" onPress={onPrev} />
      <Text variant="headline" align="center" style={{ flex: 1, fontVariant: ['tabular-nums'] }}>
        {label}
      </Text>
      <IconButton icon="chevronRight" label={nextLabel} variant="ghost" onPress={onNext} disabled={!canNext} />
    </View>
  );
}

/** Thin budget bar: accent while on track, warn when ahead of the month, down when over. */
export function BudgetBar({ host, percent, elapsed, status }: { host: HostUI; percent: number; elapsed: number; status: 'ok' | 'ahead' | 'over' }) {
  const t = host.useTheme();
  const fill = status === 'over' ? t.colors.down : status === 'ahead' ? t.colors.warn : t.colors.accent;
  return (
    <View style={{ height: 8, borderRadius: t.radius.full, backgroundColor: t.colors.surface2, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, Math.max(0, percent * 100))}%`, height: 8, borderRadius: t.radius.full, backgroundColor: fill }} />
      {/* Where the month is now: spending left of it is on pace. */}
      {elapsed > 0 && elapsed < 1 ? <View style={{ position: 'absolute', left: `${elapsed * 100}%`, top: 0, bottom: 0, width: 2, backgroundColor: t.colors.textFaint }} /> : null}
    </View>
  );
}

/** One entry: category icon, note (or category), meta, signed amount. */
export function EntryRow({ host, entry, settings, s, onPress }: { host: HostUI; entry: Entry; settings: Settings; s: Strings; onPress?: () => void }) {
  const { Pressable, Icon, Text } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const cat = settings.categories.find((c) => c.id === entry.category);
  const name = categoryName(cat, locale);
  const d = new Date(entry.at);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const meta = [entry.note ? name : null, accountName(entry.account, locale), time].filter(Boolean).join(' · ');
  const income = entry.type === 'income';
  const amount = `${income ? '+' : '−'}${formatMoney(entry.amount)}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${entry.note ?? name} ${amount}`} scaleTo={0.985} haptic={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.sm }}>
        <View style={{ width: 36, height: 36, borderRadius: t.radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: income ? t.colors.upMuted : t.colors.surface2 }}>
          <Icon name={cat?.icon ?? 'more'} size={18} color={income ? t.colors.up : t.colors.textMuted} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" numberOfLines={1}>
            {entry.note ?? name}
          </Text>
          <Text variant="caption" tone="faint" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <Text variant="bodyStrong" tone={income ? 'up' : 'default'} style={{ fontVariant: ['tabular-nums'] }}>
          {amount}
        </Text>
      </View>
    </Pressable>
  );
}

/** The amount with a small currency sign: "¥ 1,234.50". */
export function Money({ host, value, variant = 'numberXL', tone }: { host: HostUI; value: number; variant?: 'numberXL' | 'numberL' | 'numberM'; tone?: 'default' | 'up' | 'down' | 'warn' }) {
  const { Text } = host.components;
  const t = host.useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.xxs }}>
      <Text variant="callout" tone={tone === 'default' || !tone ? 'muted' : tone}>
        ¥
      </Text>
      <Text variant={variant} tone={tone ?? 'default'}>
        {formatMoney(value)}
      </Text>
    </View>
  );
}
