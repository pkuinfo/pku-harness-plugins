/** The quick-add keypad as a pure state machine over the typed amount text. */

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

export const KEYS: Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

const MAX_INT_DIGITS = 7;

/**
 * Next text after a key: at most two decimals and seven integer digits, one decimal point, no
 * leading zeros ("0" then "5" → "5"; "." first → "0."). Keys that would break a rule are ignored.
 */
export function pressKey(text: string, key: Key): string {
  if (key === 'back') return text.slice(0, -1);
  const [int, frac] = text.split('.');
  if (key === '.') {
    if (text.includes('.')) return text;
    return text ? `${text}.` : '0.';
  }
  if (frac !== undefined) return frac.length >= 2 ? text : text + key;
  if (int === '0') return key;
  if (int.length >= MAX_INT_DIGITS) return text;
  return text + key;
}

/** Amount in yuan of the typed text (0 when empty or just "0."). */
export const amountOf = (text: string) => {
  const v = Number(text);
  return Number.isFinite(v) ? v : 0;
};

/** Typed text for an existing amount (editing): "18", "18.5", "18.05". */
export const textOf = (amount: number) => (Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100));
