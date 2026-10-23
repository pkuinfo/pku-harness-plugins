/**
 * Byte helpers with no platform dependencies: Hermes (React Native), Bun and old browser
 * webviews (WeChat) all run this as-is. No Buffer, btoa/atob, TextEncoder or URL.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]!] = i;

/** Base64url without padding (RFC 4648 §5). */
export function toB64url(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]! + ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]! + ALPHABET[(n >> 6) & 63]!;
  }
  return out;
}

/**
 * Strict base64url decode: only the url-safe alphabet, no padding, no whitespace, and the
 * unused trailing bits must be zero (so every byte string has exactly one encoding).
 */
export function fromB64url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw new Error('base64url: bad length');
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i++) {
    const v = LOOKUP[text[i]!];
    if (v === undefined) throw new Error('base64url: bad character');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) throw new Error('base64url: non-canonical');
  return out;
}

/** True when `text` is canonical base64url (optionally of exactly `bytes` bytes). */
export function isB64url(text: string, bytes?: number): boolean {
  try {
    const b = fromB64url(text);
    return bytes === undefined || b.length === bytes;
  } catch {
    return false;
  }
}

/** UTF-8 encode (lone surrogates become U+FFFD, like TextEncoder). */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xdc00 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** Strict UTF-8 decode: throws on malformed input (sealed payloads must round-trip exactly). */
export function fromUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    let c: number;
    let n: number;
    if (b < 0x80) (c = b), (n = 0);
    else if (b >= 0xc2 && b < 0xe0) (c = b & 0x1f), (n = 1);
    else if (b >= 0xe0 && b < 0xf0) (c = b & 0x0f), (n = 2);
    else if (b >= 0xf0 && b < 0xf5) (c = b & 0x07), (n = 3);
    else throw new Error('utf8: bad byte');
    for (let k = 1; k <= n; k++) {
      const x = bytes[i + k];
      if (x === undefined || (x & 0xc0) !== 0x80) throw new Error('utf8: bad continuation');
      c = (c << 6) | (x & 63);
    }
    if ((n === 2 && (c < 0x800 || (c >= 0xd800 && c <= 0xdfff))) || (n === 3 && (c < 0x10000 || c > 0x10ffff))) throw new Error('utf8: overlong or out of range');
    out += String.fromCodePoint(c);
    i += n + 1;
  }
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Constant-time (for equal lengths) comparison. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}
