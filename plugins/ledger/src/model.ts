/**
 * The ledger's data model. Everything lives in the plugin's kv on the device:
 * - `tx:YYYY-MM` → Entry[] of that local month, newest first (so a month loads in one read)
 * - `months` → the month keys that hold entries, ascending
 * - `settings` → categories, budgets
 */

export type EntryType = 'expense' | 'income';
export type EntrySource = 'manual' | 'agent' | 'import';

export interface Entry {
  id: string;
  type: EntryType;
  /** Yuan, > 0, two decimals. The sign comes from `type`. */
  amount: number;
  /** Category id (see Category). */
  category: string;
  /** Account id; absent = 未指定. */
  account?: string;
  note?: string;
  /** When it happened, ms epoch. */
  at: number;
  source?: EntrySource;
  /** Id in the system it was imported from (e.g. a campus-card transaction): dedupes re-imports. */
  externalId?: string;
}

export interface Category {
  id: string;
  type: EntryType;
  /** Host icon name. */
  icon: string;
  /** User-given name; built-in categories without one show their localized default. */
  name?: string;
  hidden?: boolean;
  /** Added by the user (can be renamed freely; built-ins keep their id). */
  custom?: boolean;
}

export interface Budgets {
  /** Monthly total for spending, yuan. */
  total?: number;
  /** Monthly limit per expense category id, yuan. */
  categories: Record<string, number>;
}

export interface Settings {
  categories: Category[];
  budgets: Budgets;
}

/** Built-in categories, in grid order. Names per locale live in DEFAULT_NAMES. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'food', type: 'expense', icon: 'food' },
  { id: 'transport', type: 'expense', icon: 'bus' },
  { id: 'shopping', type: 'expense', icon: 'store' },
  { id: 'daily', type: 'expense', icon: 'basket' },
  { id: 'study', type: 'expense', icon: 'book' },
  { id: 'fun', type: 'expense', icon: 'ticket' },
  { id: 'housing', type: 'expense', icon: 'house' },
  { id: 'medical', type: 'expense', icon: 'medical' },
  { id: 'phone', type: 'expense', icon: 'phone' },
  { id: 'gifts', type: 'expense', icon: 'gift' },
  { id: 'other', type: 'expense', icon: 'more' },
  { id: 'allowance', type: 'income', icon: 'wallet' },
  { id: 'salary', type: 'income', icon: 'briefcase' },
  { id: 'scholarship', type: 'income', icon: 'medal' },
  { id: 'parttime', type: 'income', icon: 'wrench' },
  { id: 'redpacket', type: 'income', icon: 'gift' },
  { id: 'invest', type: 'income', icon: 'trendUp' },
  { id: 'other-income', type: 'income', icon: 'more' },
];

export const DEFAULT_NAMES: Record<'zh-Hans' | 'en', Record<string, string>> = {
  'zh-Hans': {
    food: '餐饮',
    transport: '交通',
    shopping: '购物',
    daily: '日用',
    study: '学习',
    fun: '娱乐',
    housing: '住房',
    medical: '医疗',
    phone: '通讯',
    gifts: '人情',
    other: '其他',
    allowance: '生活费',
    salary: '工资',
    scholarship: '奖助学金',
    parttime: '兼职',
    redpacket: '红包',
    invest: '理财',
    'other-income': '其他',
  },
  en: {
    food: 'Food',
    transport: 'Transport',
    shopping: 'Shopping',
    daily: 'Daily needs',
    study: 'Study',
    fun: 'Fun',
    housing: 'Housing',
    medical: 'Health',
    phone: 'Phone & net',
    gifts: 'Gifts',
    other: 'Other',
    allowance: 'Allowance',
    salary: 'Salary',
    scholarship: 'Scholarships',
    parttime: 'Part-time',
    redpacket: 'Red packets',
    invest: 'Investments',
    'other-income': 'Other',
  },
};

/** Fallback category per type (unknown or deleted ids land here). */
export const OTHER: Record<EntryType, string> = { expense: 'other', income: 'other-income' };

export const ACCOUNTS = ['campus-card', 'wechat', 'alipay', 'bank', 'cash'] as const;
export type AccountId = (typeof ACCOUNTS)[number];

export const ACCOUNT_NAMES: Record<'zh-Hans' | 'en', Record<AccountId, string>> = {
  'zh-Hans': { 'campus-card': '校园卡', wechat: '微信', alipay: '支付宝', bank: '银行卡', cash: '现金' },
  en: { 'campus-card': 'Campus Card', wechat: 'WeChat', alipay: 'Alipay', bank: 'Bank card', cash: 'Cash' },
};

/** Icons the user can pick for a new category (all in the host icon set). */
export const CATEGORY_ICONS = ['food', 'bus', 'store', 'basket', 'book', 'ticket', 'house', 'medical', 'phone', 'gift', 'wallet', 'briefcase', 'medal', 'wrench', 'trendUp', 'card', 'drop', 'bolt', 'school', 'sparkles', 'more'];

export function defaultSettings(): Settings {
  return { categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })), budgets: { categories: {} } };
}

/** Display name of a category in a locale (user name wins). */
export function categoryName(c: Category | undefined, locale: 'zh-Hans' | 'en' = 'zh-Hans'): string {
  if (!c) return DEFAULT_NAMES[locale].other;
  return c.name ?? DEFAULT_NAMES[locale][c.id] ?? DEFAULT_NAMES['zh-Hans'][c.id] ?? c.id;
}

export function accountName(id: string | undefined, locale: 'zh-Hans' | 'en' = 'zh-Hans'): string | undefined {
  if (!id) return undefined;
  return ACCOUNT_NAMES[locale][id as AccountId] ?? id;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * A category from what a person or the model typed: id, the user's name, or a default name in
 * either language. Restricted to `type` when given. Undefined when nothing matches.
 */
export function resolveCategory(categories: Category[], input: string, type?: EntryType): Category | undefined {
  const q = norm(input);
  if (!q) return undefined;
  const pool = type ? categories.filter((c) => c.type === type) : categories;
  return (
    pool.find((c) => c.id === q) ??
    pool.find((c) => c.name != null && norm(c.name) === q) ??
    pool.find((c) => norm(DEFAULT_NAMES['zh-Hans'][c.id] ?? '') === q || norm(DEFAULT_NAMES.en[c.id] ?? '') === q)
  );
}

/** Account id from an id or a name in either language ("微信", "wechat", "WeChat Pay"). */
export function resolveAccount(input: string): AccountId | undefined {
  const q = norm(input);
  if (!q) return undefined;
  for (const id of ACCOUNTS) {
    if (q === id || q === norm(ACCOUNT_NAMES['zh-Hans'][id]) || q === norm(ACCOUNT_NAMES.en[id])) return id;
  }
  if (/微信|wechat|weixin/.test(q)) return 'wechat';
  if (/支付宝|alipay/.test(q)) return 'alipay';
  if (/校园卡|饭卡|一卡通|campus/.test(q)) return 'campus-card';
  if (/银行|bank|信用卡|储蓄卡/.test(q)) return 'bank';
  if (/现金|cash/.test(q)) return 'cash';
  return undefined;
}
