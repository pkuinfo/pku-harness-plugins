/**
 * Where payment codes come from. The real source asks the Campus Card service through the
 * host's signed-in session (`@pku-harness/campus-card`); the mock lets the whole share flow run
 * in development and tests without a card (docs/CLOUD.md "Local testing").
 */
import { cardAccount, cardHolder, cardMode, paymentCode, turnoverPage, type Turnover } from '@pku-harness/campus-card';
import type { HostServices } from '@pku-harness/sdk';

export type MintedCode = { code: string; balance: number | null };

/** Thrown when the card is not in 数字卡 mode: codes would not scan. */
export class NotDigitalError extends Error {
  constructor(readonly current: string) {
    super(`付款码只能在「数字卡」用卡方式下使用（当前：${current}）`);
    this.name = 'NotDigitalError';
  }
}

export interface CodeSource {
  readonly kind: 'card' | 'mock';
  /** Holder's name, for the masked-name gate. */
  holder(): Promise<string>;
  /** Throws NotDigitalError when codes can't be used. */
  ready(): Promise<void>;
  /** A fresh payment code. Never log or return it from a tool. */
  mint(): Promise<MintedCode>;
  /** Recent turnover records (newest first), at least those since `since` (ms) when possible. */
  turnover(since: number): Promise<Turnover[]>;
}

/** Beijing date "YYYY-MM-DD" of a ms epoch (the card API filters by its local date). */
export function beijingDate(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}

export function cardSource(services: Pick<HostServices, 'campus'>): CodeSource {
  let account: string | null = null;
  const acc = async () => (account ??= await cardAccount(services));
  return {
    kind: 'card',
    holder: async () => {
      const h = await cardHolder(services);
      account ??= h.account;
      return h.name;
    },
    ready: async () => {
      const mode = await cardMode(services);
      if (!mode.digital) throw new NotDigitalError(mode.name);
    },
    mint: async () => {
      const p = await paymentCode(services, await acc());
      return { code: p.code, balance: p.balance };
    },
    turnover: async (since) => (await turnoverPage(services, { size: 30, from: beijingDate(since) })).records,
  };
}

/**
 * Deterministic fake card: codes `MOCK-<n>-<time>`, a balance that drops with each payment, and
 * payments you add with `pay()` (tests, or the dev toggle in the plugin's settings).
 */
export class MockSource implements CodeSource {
  readonly kind = 'mock' as const;
  minted = 0;
  balance: number;
  records: Turnover[] = [];
  failNext: Error | null = null;
  constructor(
    private readonly opts: { name?: string; balance?: number; now?: () => number } = {},
  ) {
    this.balance = opts.balance ?? 128.5;
  }
  private now() {
    return this.opts.now?.() ?? Date.now();
  }
  async holder() {
    return this.opts.name ?? '王小明';
  }
  async ready() {}
  async mint() {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    this.minted++;
    return { code: `MOCK-${this.minted}-${this.now()}`, balance: this.balance };
  }
  async turnover() {
    return [...this.records];
  }
  /** Record a payment of `yuan` at `at` (default now), newest first like the API. */
  pay(yuan: number, title = '学五食堂', at = this.now()) {
    this.balance = Math.round((this.balance - yuan) * 100) / 100;
    const d = new Date(at + 8 * 3600_000).toISOString();
    this.records.unshift({ resume: title, turnoverType: '餐费', tranamt: Math.round(yuan * 100), cardBalance: Math.round(this.balance * 100), effectdateStr: `${d.slice(0, 10)} ${d.slice(11, 19)}`, icon: 'meal' });
  }
}
