import { describe, expect, test } from 'bun:test';

import { widgetMinHeight, widgetWidth } from './dashboard/src/ui/layout';

describe('dashboard widget sizes', () => {
  test('sm is one column; md and lg are full width', () => {
    expect(widgetWidth('sm', 350, 2, 10)).toBe(170);
    expect(widgetWidth('sm', 700, 3, 10)).toBeCloseTo(226.67, 2);
    expect(widgetWidth('md', 350, 2, 10)).toBe(350);
    expect(widgetWidth('lg', 350, 2, 10)).toBe(350);
  });

  test('only lg is taller than its content, so Wide and Large differ', () => {
    expect(widgetMinHeight('sm', 170)).toBeUndefined();
    expect(widgetMinHeight('md', 350)).toBeUndefined();
    expect(widgetMinHeight('lg', 360)).toBe(180);
    expect(widgetMinHeight('lg', 400)).toBe(200);
  });

  test('the large frame stays within bounds on narrow and wide screens', () => {
    expect(widgetMinHeight('lg', 240)).toBe(180);
    expect(widgetMinHeight('lg', 1000)).toBe(320);
  });
});
