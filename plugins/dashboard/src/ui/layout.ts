import type { WidgetSize } from '@pku-harness/sdk';

/**
 * What each widget size means on the dashboard grid (pure: unit-tested).
 * - sm: a tile, one grid column wide.
 * - md (Wide): full width, as tall as its content.
 * - lg (Large): full width and taller, a hero card (at least half as tall as it is wide).
 * Plugin widgets also receive the size and adapt their content; AI-built specs get it as `/size`.
 */
export function widgetWidth(size: WidgetSize, gridWidth: number, columns: number, gap: number): number {
  if (size !== 'sm') return gridWidth;
  return (gridWidth - gap * (columns - 1)) / columns;
}

/** Minimum card height for a size (undefined = content height). Large cards keep a 2:1 frame, within bounds. */
export function widgetMinHeight(size: WidgetSize, width: number): number | undefined {
  if (size !== 'lg') return undefined;
  return Math.round(Math.min(320, Math.max(180, width / 2)));
}

const ORDER: WidgetSize[] = ['sm', 'md', 'lg'];

/** The size after `size` when cycling in edit mode, skipping sizes the widget doesn't support (undefined = all). */
export function nextWidgetSize(size: WidgetSize, supported?: readonly WidgetSize[]): WidgetSize {
  const allowed = supported?.length ? supported : ORDER;
  for (let i = 1; i <= ORDER.length; i++) {
    const next = ORDER[(ORDER.indexOf(size) + i) % ORDER.length];
    if (allowed.includes(next)) return next;
  }
  return size;
}
