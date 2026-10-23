/**
 * Static viewer pages: `<pagesDir>/<plugin>/web/dist` is served at `/w/<plugin>/*` with a
 * strict CSP, and `GET /s/:id` redirects a share link to the channel's page.
 *
 * A page `view` is `dist/view.html` or `dist/view/index.html`; other files (assets) are served
 * by path. Plugin folders are rescanned at most every few seconds, so `vite build` output
 * shows up without restarting `cloud:dev`.
 */
import { type Dirent, existsSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

import { channelIdSchema, pageNameSchema, pluginIdSchema } from '@pku-harness/cloud-protocol';
import type { Hono } from 'hono';

import type { AppEnv, Deps } from './context';
import { HttpError } from './errors';

/** Viewer pages may only talk to this origin; no inline scripts, no framing. */
export const PAGE_CSP =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const PAGE_HEADERS: Record<string, string> = {
  'Content-Security-Policy': PAGE_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

interface PluginPages {
  dist: string;
  pages: Set<string>;
}

export class PageRegistry {
  private plugins = new Map<string, PluginPages>();
  private scannedAt = -Infinity;

  constructor(
    private readonly dir: string,
    private readonly rescanMs = 5000,
  ) {}

  private scan() {
    const now = Date.now();
    if (now - this.scannedAt < this.rescanMs) return;
    this.scannedAt = now;
    const found = new Map<string, PluginPages>();
    let entries: Dirent[] = [];
    try {
      entries = readdirSync(this.dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const e of entries) {
      if (!e.isDirectory() || !pluginIdSchema.safeParse(e.name).success) continue;
      const dist = join(this.dir, e.name, 'web', 'dist');
      if (!existsSync(dist)) continue;
      const pages = new Set<string>();
      for (const f of readdirSync(dist, { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith('.html')) {
          const name = f.name.slice(0, -5);
          if (pageNameSchema.safeParse(name).success) pages.add(name);
        } else if (f.isDirectory() && pageNameSchema.safeParse(f.name).success && existsSync(join(dist, f.name, 'index.html'))) pages.add(f.name);
      }
      found.set(e.name, { dist, pages });
    }
    this.plugins = found;
  }

  list(): { plugin: string; page: string }[] {
    this.scan();
    const out: { plugin: string; page: string }[] = [];
    for (const [plugin, p] of [...this.plugins].sort(([a], [b]) => a.localeCompare(b))) for (const page of [...p.pages].sort()) out.push({ plugin, page });
    return out;
  }

  has(plugin: string, page: string): boolean {
    this.scan();
    return this.plugins.get(plugin)?.pages.has(page) ?? false;
  }

  /** Absolute path of the file for `/w/<plugin>/<rest>`, or undefined. Never escapes dist. */
  resolve(plugin: string, rest: string): string | undefined {
    this.scan();
    const p = this.plugins.get(plugin);
    if (!p) return undefined;
    const segs = rest.split('/').filter(Boolean);
    if (segs.some((s) => s.startsWith('.') || s.includes('\\') || s.includes('\0'))) return undefined;
    const candidates = segs.length === 1 && p.pages.has(segs[0]!) ? [`${segs[0]}.html`, `${segs[0]}/index.html`] : [segs.join('/')];
    for (const c of candidates) {
      const full = normalize(join(p.dist, c));
      if (!full.startsWith(p.dist + sep)) continue;
      try {
        if (statSync(full).isFile()) return full;
      } catch {
        // try the next candidate
      }
    }
    return undefined;
  }
}

export function pageRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.get('/w/:plugin/*', async (c) => {
    const plugin = c.req.param('plugin');
    const prefix = `/w/${plugin}/`;
    const path = c.req.path;
    let rest: string;
    try {
      rest = decodeURIComponent(path.slice(prefix.length));
    } catch {
      throw new HttpError('not_found', 'no such page');
    }
    const file = deps.pages.resolve(plugin, rest);
    if (!file) throw new HttpError('not_found', 'no such page');
    const body = Bun.file(file);
    const isHtml = file.endsWith('.html');
    return new Response(body, {
      headers: {
        ...PAGE_HEADERS,
        'Content-Type': body.type,
        // Hashed assets can be cached; pages must pick up rebuilds.
        'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
      },
    });
  });

  /**
   * Share link → viewer page. The target is built from the channel record alone: the request's
   * query string is dropped, and the browser carries the `#k=…` fragment across the redirect
   * by itself (the server never sees it). The page gets the channel id as `?c=<id>`.
   */
  app.get('/s/:id', async (c) => {
    const id = c.req.param('id');
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    if (!channelIdSchema.safeParse(id).success) return c.text('not found', 404);
    const ch = await deps.storage.getChannel(id);
    if (!ch?.page || !deps.pages.has(ch.plugin, ch.page)) return c.text('not found', 404);
    return c.redirect(`/w/${ch.plugin}/${ch.page}?c=${id}`, 302);
  });
}
