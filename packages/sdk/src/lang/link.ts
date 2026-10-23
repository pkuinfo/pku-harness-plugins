/**
 * Install links (docs/PLUGIN-LANGUAGE.md §10) → where to fetch PLUGIN.md and its files.
 *
 *   https://github.com/<owner>/<repo>                        (PLUGIN.md at the root)
 *   https://github.com/<owner>/<repo>/tree/<ref>/<path>
 *   https://github.com/<owner>/<repo>/blob/<ref>/<path>/PLUGIN.md
 *   https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>/PLUGIN.md
 *   any https URL of a PLUGIN.md (gists, self-hosted folders)
 *   pkuharness://plugin?src=<url-encoded link of any form above>
 */

export type PluginLink = {
  /** URLs to try in order for PLUGIN.md; files resolve relative to the one that worked. */
  candidates: string[];
  /** The canonical link to show and to re-fetch for updates. */
  canonical: string;
  /** Marketplace handle `owner/repo/path` for GitHub links. */
  handle?: string;
};

export class LinkError extends Error {}

const GH = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.*))?)?\/?$/;
const RAW = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/([^/]+)\/(.*)$/;

function github(owner: string, repo: string, ref: string | undefined, path: string): PluginLink {
  const dir = path.replace(/\/?PLUGIN\.md$/i, '').replace(/^\/+|\/+$/g, '');
  const tail = dir ? `${dir}/PLUGIN.md` : 'PLUGIN.md';
  const r = ref ?? 'HEAD';
  const candidates = [`https://raw.githubusercontent.com/${owner}/${repo}/${r}/${tail}`];
  if (ref) candidates.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${tail}`);
  return {
    candidates,
    canonical: `https://github.com/${owner}/${repo}${ref || dir ? `/tree/${r}${dir ? `/${dir}` : ''}` : ''}`,
    handle: `${owner}/${repo}${dir ? `/${dir}` : ''}`,
  };
}

export function resolveLink(input: string): PluginLink {
  let s = input.trim();
  if (/^pkuharness:\/\/plugin/i.test(s)) {
    const src = /[?&]src=([^&#]+)/.exec(s)?.[1];
    if (!src) throw new LinkError('this pkuharness:// link has no src');
    s = decodeURIComponent(src);
  }
  if (/^github\.com\//i.test(s)) s = `https://${s}`;
  const gh = GH.exec(s);
  if (gh) return github(gh[1]!, gh[2]!, gh[4], gh[5] ?? '');
  const raw = RAW.exec(s);
  if (raw) return github(raw[1]!, raw[2]!, raw[3], raw[4]!);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new LinkError('not a link: paste a GitHub folder or the URL of a PLUGIN.md');
  }
  if (u.protocol !== 'https:') throw new LinkError('plugin links must use https://');
  const href = u.toString();
  const url = /\/PLUGIN\.md$/i.test(u.pathname) ? href : href.replace(/\/?$/, '/PLUGIN.md');
  return { candidates: [url], canonical: url };
}

/** URL of a file named in the frontmatter, relative to PLUGIN.md. */
export function fileUrl(pluginMdUrl: string, path: string): string {
  return new URL(path, pluginMdUrl).toString();
}

/** The deep link that installs a plugin from any link. */
export function installDeepLink(link: string): string {
  return `pkuharness://plugin?src=${encodeURIComponent(link)}`;
}
