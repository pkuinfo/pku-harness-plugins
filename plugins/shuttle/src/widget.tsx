import type { PluginWidgetProps } from '@pku-harness/sdk';
import { View } from 'react-native';

import { AREA_NAMES, beijing, formatIn, nextDepartures, resolvePlace } from './schedule';

/**
 * Next shuttle with a live countdown, computed on the device from the static timetable (no
 * network, no tool call). Default: 燕园→新燕园 (sm) or both directions (md/lg); config.from /
 * config.to pick another pair.
 */
export function NextShuttleWidget({ host, size, config }: PluginWidgetProps) {
  const { Text } = host.components;
  const t = host.useTheme();
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
        const label = `${p.from ? AREA_NAMES[p.from] : '任意站'} → ${p.to ? AREA_NAMES[p.to] : '任意站'}`;
        const first = deps[0];
        return (
          <View key={label} style={{ gap: t.spacing.xxs }} accessible accessibilityLabel={first ? `${label}，下一班 ${first.time}，${formatIn(first, today)}` : `${label}，今明两天没有班次`}>
            <Text variant="micro" tone="faint">
              {label.replace(/校区/g, '')}
            </Text>
            {first ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: t.spacing.sm }}>
                  <Text variant={size === 'sm' ? 'numberL' : 'numberM'}>{first.time}</Text>
                  <Text variant="caption" tone={first.date === today && first.inMinutes <= 15 ? 'warn' : 'muted'}>
                    {formatIn(first, today)}
                  </Text>
                </View>
                {deps.length > 1 && size !== 'sm' ? (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    之后 {deps
                      .slice(1)
                      .map((d) => (d.date === today ? d.time : `${d.weekday} ${d.time}`))
                      .join(' · ')}
                  </Text>
                ) : null}
              </>
            ) : (
              <Text variant="caption" tone="muted">
                今明两天没有班次
              </Text>
            )}
          </View>
        );
      })}
      {size !== 'sm' ? (
        <Text variant="micro" tone="faint" numberOfLines={2}>
          需在门户「新校区班车预约」预约 · 节假日按周末表
        </Text>
      ) : null}
    </View>
  );
}
