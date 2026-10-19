/**
 * Request-body encoding of the Wingsoft portal (pkucli crates/cwfw/src/encrypt.rs, after
 * `picList.encode` / `encode2` in jquery.picList.js). Every key and value of every
 * `common*_*.action` / `loadDefinition.action` form goes through
 * `encode(encode2(x))`:
 *   encode2(x) = base64(utf8(x))
 *   encode(x)  = b = base64(utf8(x + 5 random chars)); swap b[t] ↔ b[len-1-t] for even t < len/2; b + "eEc"
 * It is obfuscation, not secrecy; the salt only needs to vary.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** picList.randomStr charset. */
const SALT = 'poiuytrewqasdfghjklmnbvcxzQWERTYUIOPLKJHGFDSAZXCVBNM123456789';

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

export function base64(s: string): string {
  const b = utf8(s);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}

/** The even-position mirror swap of `picList.encode` (its own inverse). */
export function mirror(s: string): string {
  const c = s.split('');
  for (let t = 0; t < Math.floor(c.length / 2); t += 2) [c[t], c[c.length - 1 - t]] = [c[c.length - 1 - t], c[t]];
  return c.join('');
}

const salt = (n: number) => Array.from({ length: n }, () => SALT[Math.floor(Math.random() * SALT.length)]).join('');

export const encode2 = base64;
export const encode = (s: string, saltChars = salt(5)) => `${mirror(base64(s + saltChars))}eEc`;
export const encrypt = (s: string) => encode(encode2(s));

/** encrypt.rs `encrypt_form`: urlencoded body with every key and value encrypted. */
export const encryptForm = (pairs: [string, string][]) => pairs.map(([k, v]) => `${encodeURIComponent(encrypt(k))}=${encodeURIComponent(encrypt(v))}`).join('&');
