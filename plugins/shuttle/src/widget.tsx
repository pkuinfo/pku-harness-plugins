import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { beijing, nextDepartures, resolvePlace } from './schedule';
import { departureDay, strings } from './strings';

/**
 * Next shuttle with a live countdown, computed on the device from the static timetable (no
 * network, no tool call). Default: 燕园→新燕园 (sm) or both directions (md/lg); config.from /
 * config.to pick another pair.
 */
export function NextShuttleWidget({ host, size, config }: PluginWidgetProps) {
  const { Text } = host.components;
  const t = host.useTheme();
  const locale = host.useLocale();
  const s = strings[locale];
  const now = host.useNow(30_000);
  const nowMs = now.getTime();
  const today = beijing(nowMs).date;
  const from = resolvePlace(typeof config.from === 'string' ? config.from : undefined);
  const to = resolvePlace(typeof config.to === 'string' ? config.to : undefined);
  const pairs =
    from || to
      ? [{ from, to }]
      : size === 'sm'
        ? [{ from: 'yanyuan' as const, to: 'xinyanyuan' as const }]
        : [
            { from: 'yanyuan' as const, to: 'xinyanyuan' as const },
            { from: 'xinyanyuan' as const, to: 'yanyuan' as const },
          ];
  const perDirection = size === 'lg' ? 3 : 2;
  return (
    <View style={{ gap: t.spacing.md }}>
      {pairs.map((p) => {
        const deps = nextDepartures({ from: p.from, to: p.to, nowMs, count: perDirection });
        const label = `${p.from ? s.areas[p.from] : s.anyStop} → ${p.to ? s.areas[p.to] : s.anyStop}`;
        const first = deps[0];
        return (
          <View key={label} style={{ gap: t.spacing.xxs }} accessible accessibilityLabel={first ? s.a11yNext(label, first.time, s.formatIn(first, today)) : s.a11yNone(label)}>
            <Text variant="micro" tone="faint">
              {label}
            </Text>
            {first ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.sm }}>
                  <Text variant={size === 'sm' ? 'numberL' : 'numberM'}>{first.time}</Text>
                  <Text variant="caption" tone={first.date === today && first.inMinutes <= 15 ? 'warn' : 'muted'}>
                    {s.formatIn(first, today)}
                  </Text>
                </View>
                {deps.length > 1 && size !== 'sm' ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {s.later(
                      deps
                        .slice(1)
                        .map((d) => (d.date === today ? d.time : `${departureDay(d, locale)} ${d.time}`))
                        .join(' · '),
                    )}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="caption" tone="muted">
                {s.none}
              </Text>
            )}
          </View>
        );
      })}
      {size !== 'sm' ? (
        <Text variant="micro" tone="faint" numberOfLines={2}>
          {s.footnote}
        </Text>
      ) : null}
    </View>
  );
}
