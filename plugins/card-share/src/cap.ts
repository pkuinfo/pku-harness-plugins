/**
 * Spend cap (docs/CLOUD.md §1.3): what the card paid since the share started, from the card's
 * own turnover list (`/berserker-search/search/personal/turnover`). Pure, so it is tested with
 * fixtures. The cap is checked per payment, so the last one can overshoot it; the card's own
 * daily limit (`daycostlimit`) still applies on top.
 */
import { INCOME_ICONS, type Turnover } from '../../shared/campus-card';

/** One payment seen during the share. */
export type SharePayment = { key: string; at: number; title: string; amount: number };

export type CapState = {
  /** Yuan spent since the share started (sum of `payments`). */
  spent: number;
  payments: SharePayment[];
  /** Spend cap reached (`spent >= capYuan`). Always false without a cap. */
  reached: boolean;
};

/**
 * `effectdateStr` ("2026-10-23 12:03:44", Beijing time) → ms epoch. The card service reports
 * China Standard Time regardless of the phone's zone. Undefined when unparseable.
 */
export function parseCardTime(s: string | undefined): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s?.trim() ?? '');
  if (!m) return undefined;
  const [, y, mo, d, h, mi, se] = m;
  return Date.UTC(+y!, +mo! - 1, +d!, +h! - 8, +mi!, se ? +se : 0);
}

/** The card's clock and ours disagree a little, and effectdateStr has second precision. */
export const CLOCK_SLACK_MS = 60_000;

const isSpending = (t: Turnover) => !INCOME_ICONS.has(t.icon ?? '') && t.tranamt > 0;

/** Stable identity for a record across polls (the API has no id). */
export const paymentKey = (t: Turnover) => `${t.effectdateStr ?? ''}|${t.tranamt}|${t.cardBalance}|${t.resume ?? ''}`;

/**
 * Payments since `startedAt` (ms) from one or more turnover pages, merged with what earlier
 * polls already saw (records can drop off the first page when there are many).
 */
export function evaluateCap(records: readonly Turnover[], startedAt: number, capYuan: number | null, seen: readonly SharePayment[] = []): CapState {
  const byKey = new Map<string, SharePayment>(seen.map((p) => [p.key, p]));
  for (const t of records) {
    if (!isSpending(t)) continue;
    const at = parseCardTime(t.effectdateStr);
    if (at === undefined || at < startedAt - CLOCK_SLACK_MS) continue;
    const key = paymentKey(t);
    if (!byKey.has(key)) byKey.set(key, { key, at, title: t.resume?.trim() || '消费', amount: Math.round(t.tranamt) / 100 });
  }
  const payments = [...byKey.values()].sort((a, b) => a.at - b.at);
  const spent = Math.round(payments.reduce((s, p) => s + p.amount * 100, 0)) / 100;
  return { spent, payments, reached: capYuan != null && spent >= capYuan };
}

/** Offsets after each issued code at which turnover is polled (docs/CLOUD.md §1.3). */
export const CAP_CHECKS_AFTER_CODE_MS = [20_000, 60_000, 120_000] as const;
/** Background poll while a share is active. */
export const CAP_POLL_MS = 120_000;

/** Yuan left before the cap (never negative); null without a cap. */
export const capLeft = (state: Pick<CapState, 'spent'>, capYuan: number | null) => (capYuan == null ? null : Math.max(0, Math.round((capYuan - state.spent) * 100) / 100));
