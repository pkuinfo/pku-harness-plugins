/**
 * its.pku.edu.cn account page parsing, ported from pkucli crates/portal/src/netfee.rs
 * (`apply_itsutil_info`, `parse_billing`) without an HTML parser: `td.td_name` / `td.td_value`
 * cells pair up; names contain full-width spaces (e.g. 「余　　额」).
 */
export function parseItsInfo(html: string): Record<string, string> {
  const cells = [...html.matchAll(/<td[^>]*class=["'][^"']*\b(td_name|td_value)\b[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi)].map((m) => ({
    name: m[1].toLowerCase() === 'td_name',
    text: m[2]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/[　 \s]/g, '')
      .replace(/[:：]$/, ''),
  }));
  const pairs: Record<string, string> = {};
  for (let i = 0; i + 1 < cells.length; i++) {
    if (cells[i].name && !cells[i + 1].name) {
      pairs[cells[i].text] = cells[i + 1].text;
      i++;
    }
  }
  return pairs;
}

export function parseBilling(html: string) {
  const num = (rx: RegExp) => rx.exec(html)?.[1] ?? null;
  return {
    balance: num(/(?:账户余额|余\s*额)\s*[:：]?\s*([0-9.-]+)\s*元/),
    monthlyUsage: /(?:本月使用|已用流量|本月流量)\s*[:：]?\s*([0-9.]+\s*(?:MB|GB|KB|mb|gb))/.exec(html)?.[1] ?? null,
    monthlyFee: num(/(?:本月费用|月\s*费用)\s*[:：]?\s*([0-9.]+)\s*元/),
  };
}

export const toNumber = (s: string | null | undefined) => {
  if (!s) return null;
  const n = parseFloat(s.replace(/元$/, ''));
  return Number.isFinite(n) ? n : null;
};
