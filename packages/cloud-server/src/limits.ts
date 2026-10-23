/**
 * Token-bucket rate limits (a generalised port of pkubdcard's per-IP `rateLimiter`): buckets
 * are keyed per IP, per device, per (device, plugin, service) or per (channel, peer). HTTP
 * responses carry `RateLimit-Limit/Remaining/Reset` and `RateLimit-Policy` for the tightest
 * bucket that was checked; a refusal is a 429 `errorBody` with `retryAfterS` and `Retry-After`.
 */
import type { Context } from 'hono';

import type { Rate } from './config';
import type { AppEnv } from './context';
import { HttpError } from './errors';

export interface Take {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the bucket is full again. */
  resetS: number;
  /** Seconds until one token is available (when refused). */
  retryAfterS: number;
  windowS: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

export class RateLimiter {
  private buckets = new Map<string, { b: Bucket; rate: Rate }>();

  constructor(private readonly now: () => number) {}

  take(key: string, rate: Rate, cost = 1): Take {
    const now = this.now();
    const perMs = rate.limit / (rate.windowS * 1000);
    let e = this.buckets.get(key);
    if (!e) {
      e = { b: { tokens: rate.limit, at: now }, rate };
      this.buckets.set(key, e);
    }
    const b = e.b;
    b.tokens = Math.min(rate.limit, b.tokens + (now - b.at) * perMs);
    b.at = now;
    const ok = b.tokens >= cost;
    if (ok) b.tokens -= cost;
    return {
      ok,
      limit: rate.limit,
      remaining: Math.max(0, Math.floor(b.tokens)),
      resetS: Math.ceil((rate.limit - b.tokens) / perMs / 1000),
      retryAfterS: ok ? 0 : Math.max(1, Math.ceil((cost - b.tokens) / perMs / 1000)),
      windowS: rate.windowS,
    };
  }

  /** Drop buckets that have refilled completely (they'd be recreated full anyway). */
  sweep() {
    const now = this.now();
    for (const [k, { b, rate }] of this.buckets) if (now - b.at >= rate.windowS * 1000) this.buckets.delete(k);
  }

  get size() {
    return this.buckets.size;
  }
}

/**
 * Take from a bucket for an HTTP request. Throws 429 when empty; otherwise remembers the
 * tightest result for the response headers (set by `rateLimitHeaders`).
 */
export function limit(c: Context<AppEnv>, limiter: RateLimiter, key: string, rate: Rate): void {
  const t = limiter.take(key, rate);
  const prev = c.get('rl');
  if (!t.ok || !prev || t.remaining / t.limit < prev.remaining / prev.limit) c.set('rl', t);
  if (!t.ok) throw new HttpError('rate_limited', 'rate limit exceeded', t.retryAfterS);
}

export function applyRateLimitHeaders(c: Context<AppEnv>): void {
  const t = c.get('rl');
  if (!t) return;
  c.header('RateLimit-Limit', String(t.limit));
  c.header('RateLimit-Remaining', String(t.remaining));
  c.header('RateLimit-Reset', String(t.resetS));
  c.header('RateLimit-Policy', `${t.limit};w=${t.windowS}`);
  if (!t.ok) c.header('Retry-After', String(t.retryAfterS));
}
