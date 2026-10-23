// Where this page's share comes from. GET /s/:id redirects to /w/card-share/view?c=<id> and the
// browser carries the #k=… fragment across the redirect; the fragment never reaches a server.

import { buildAppShareLink, CHANNEL_ID_RE, parseKeyFragment } from "@pku-harness/cloud-protocol";

export interface PageShare {
  /** Relay origin + path prefix (the part before /w/). */
  base: string;
  channelId: string;
  k: Uint8Array;
  /** pkuharness://share/<id>#k=… for the open-in-app banner. */
  appLink: string;
}

export function readShare(loc: Pick<Location, "origin" | "pathname" | "search" | "hash">): PageShare | undefined {
  const k = parseKeyFragment(loc.hash);
  if (!k) return undefined;
  const q = /[?&]c=([^&#]+)/.exec(loc.search)?.[1];
  // Fallbacks: /w/<plugin>/view/<id>, or a link opened as /s/<id> directly.
  const fromPath = /\/(?:view|s)\/([A-Za-z0-9_-]+)\/?$/.exec(loc.pathname)?.[1];
  const channelId = q ? decodeURIComponent(q) : fromPath;
  if (!channelId || !CHANNEL_ID_RE.test(channelId)) return undefined;
  const at = loc.pathname.search(/\/(?:w|s)\//);
  const base = loc.origin + (at > 0 ? loc.pathname.slice(0, at) : "");
  return { base, channelId, k, appLink: buildAppShareLink(channelId, k) };
}
