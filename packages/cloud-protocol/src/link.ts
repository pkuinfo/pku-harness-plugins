/**
 * Share links: `<base>/s/<channelId>#k=<base64url 32 bytes>` (docs/CLOUD.md §1.3). The
 * fragment never reaches the server. Parsing is regex-based on purpose: React Native's URL
 * polyfill doesn't implement `hash`/`pathname` reliably, and viewer pages must not depend on it.
 */
import { fromB64url, toB64url } from './bytes';
import { KEY_BYTES } from './crypto';

/** Channel ids are server-generated base64url (16 random bytes → 22 chars); accept 8–64. */
export const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Matches the secret part of a share link (https `/s/<id>#k=…` or app `://share/<id>#k=…`) in text. Global. */
export const SHARE_LINK_SCRUB_RE = /(?:\/s\/|:\/\/share\/)[A-Za-z0-9_-]+#k=[A-Za-z0-9_-]*/g;
const KEY_FRAGMENT_RE = /#((?:[^\s#&]*&)*)k=[A-Za-z0-9_-]{43}/g;

/**
 * Redact share links from text bound for the model or logs (docs/CLOUD.md §2.8): link paths
 * become `[secret link]`, and any other `#…k=<32-byte key>` fragment (e.g. a viewer page URL
 * after the `/s/` redirect) loses its key.
 */
export function scrubShareLinks(text: string): string {
  return text.replace(SHARE_LINK_SCRUB_RE, '[secret link]').replace(KEY_FRAGMENT_RE, '#$1k=[redacted]');
}

/** App deep link scheme (`pkuharness://share/<id>#k=…`). */
export const APP_SCHEME = 'pkuharness';

export interface ParsedShareLink {
  /** Provider origin + path prefix, no trailing slash (`https://s.example.org`); undefined for app deep links. */
  base?: string;
  channelId: string;
  /** The 32-byte link secret. */
  k: Uint8Array;
}

function normaliseBase(base: string): string {
  const m = /^(https?:\/\/[^/?#\s]+)(\/[^?#\s]*)?$/i.exec(base.trim());
  if (!m) throw new Error('share link base must be an http(s) URL without query or fragment');
  return (m[1]! + (m[2] ?? '')).replace(/\/+$/, '');
}

export function buildShareLink(base: string, channelId: string, k: Uint8Array): string {
  if (!CHANNEL_ID_RE.test(channelId)) throw new Error('bad channel id');
  if (k.length !== KEY_BYTES) throw new Error('share secret must be 32 bytes');
  return `${normaliseBase(base)}/s/${channelId}#k=${toB64url(k)}`;
}

export function buildAppShareLink(channelId: string, k: Uint8Array): string {
  if (!CHANNEL_ID_RE.test(channelId)) throw new Error('bad channel id');
  if (k.length !== KEY_BYTES) throw new Error('share secret must be 32 bytes');
  return `${APP_SCHEME}://share/${channelId}#k=${toB64url(k)}`;
}

/**
 * Read `k` from a fragment like `#k=…` or `k=…&x=1` (viewer pages read `location.hash`).
 * Returns undefined when absent or not exactly 32 bytes.
 */
export function parseKeyFragment(fragment: string): Uint8Array | undefined {
  const f = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  for (const part of f.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq) !== 'k') continue;
    try {
      const k = fromB64url(part.slice(eq + 1));
      return k.length === KEY_BYTES ? k : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Parse an https share link or an app deep link. Returns undefined for anything else
 * (wrong path, bad id, missing/short key). Tolerates surrounding whitespace, a query string
 * before the fragment and extra fragment parameters.
 */
export function parseShareLink(link: string): ParsedShareLink | undefined {
  const s = link.trim();
  const hashAt = s.indexOf('#');
  if (hashAt < 0) return undefined;
  const k = parseKeyFragment(s.slice(hashAt + 1));
  if (!k) return undefined;
  const beforeHash = s.slice(0, hashAt);
  const q = beforeHash.indexOf('?');
  const head = q < 0 ? beforeHash : beforeHash.slice(0, q);

  const app = new RegExp(`^${APP_SCHEME}://share/([^/?#]+)/?$`, 'i').exec(head);
  if (app) return CHANNEL_ID_RE.test(app[1]!) ? { channelId: app[1]!, k } : undefined;

  const web = /^(https?:\/\/[^/?#\s]+)((?:\/[^/?#\s]+)*?)\/s\/([^/?#\s]+)\/?$/i.exec(head);
  if (!web || !CHANNEL_ID_RE.test(web[3]!)) return undefined;
  return { base: web[1]! + web[2]!, channelId: web[3]!, k };
}
