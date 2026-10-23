import { describe, expect, test } from 'bun:test';

import { parseBilling, parseItsInfo, toNumber } from './parse';

describe('its.pku.edu.cn parsing', () => {
  test('pairs td_name / td_value cells, full-width spaces removed', () => {
    const html = `<table class="itsutil_account"><tr><td class="td_name">余　　额：</td><td class="td_value">36.50元</td>
      <td class="td_name">本月使用</td><td class="td_value"><span>41.2 GB</span></td></tr></table>`;
    const pairs = parseItsInfo(html);
    expect(pairs['余额']).toBe('36.50元');
    expect(pairs['本月使用']).toBe('41.2GB');
    expect(toNumber(pairs['余额'])).toBe(36.5);
  });

  test('billing text on the home page', () => {
    expect(parseBilling('<div>账户余额：12.34 元</div><p>本月流量: 3.5 GB 本月费用：10 元</p>')).toEqual({ balance: '12.34', monthlyUsage: '3.5 GB', monthlyFee: '10' });
  });
});
