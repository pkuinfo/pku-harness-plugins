/**
 * Viewer gates, checked on the sharer's phone (the relay can't read them). Ported from
 * pkubdcard internal/share/share.go (`NameHint`, `hiddenChars`, 5-failure lockout), but the
 * name and PIN never leave the device: the viewer only sees the masked hint.
 */

/** Wrong answers before the share closes itself (pkubdcard: 5). */
export const MAX_GATE_FAILURES = 5;

/** Split into characters (code points), so CJK and surrogate pairs count as one. */
export const nameChars = (name: string) => Array.from(name.trim());

/** Sorted, de-duplicated, in-range hidden positions. */
export function normaliseHidden(name: string, hidden: readonly number[]): number[] {
  const n = nameChars(name).length;
  return [...new Set(hidden)].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
}

/** "王小明" hiding [1] → "王_明" (share.go NameHint). */
export function maskName(name: string, hidden: readonly number[]): string {
  const h = new Set(normaliseHidden(name, hidden));
  return nameChars(name)
    .map((c, i) => (h.has(i) ? '_' : c))
    .join('');
}

/** What the viewer must type: the hidden characters in ascending position order (share.go hiddenChars). */
export function hiddenChars(name: string, hidden: readonly number[]): string {
  const chars = nameChars(name);
  return normaliseHidden(name, hidden)
    .map((i) => chars[i])
    .join('');
}

/** Default: hide every character but the first ("王__"), like pkubdcard's surname hint. */
export function defaultHidden(name: string): number[] {
  const n = nameChars(name).length;
  return n <= 1 ? [0] : Array.from({ length: n - 1 }, (_, i) => i + 1);
}

/** Ignore whitespace and full-width spaces the viewer may type; compare in constant time. */
const clean = (s: string) => s.replace(/[\s　]+/g, '').normalize('NFC');

function sameText(a: string, b: string): boolean {
  const x = Array.from(a);
  const y = Array.from(b);
  // No early exit: every position is compared.
  let diff = x.length === y.length ? 0 : 1;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? '') !== (y[i] ?? '')) diff |= 1;
  return diff === 0;
}

/**
 * The viewer may type just the hidden characters ("小") or the whole name ("王小明").
 */
export function checkName(answer: string, name: string, hidden: readonly number[]): boolean {
  const a = clean(answer);
  if (!a) return false;
  return sameText(a, clean(hiddenChars(name, hidden))) || sameText(a, clean(name));
}

export function checkPin(answer: string, pin: string): boolean {
  return answer.length > 0 && sameText(answer.trim(), pin);
}

/** A PIN the sharer may choose: 4–8 digits. */
export const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);
