import { describe, expect, test } from 'bun:test';

import { toB64url } from './bytes';
import { SHARE_LINK_SCRUB_RE, buildAppShareLink, buildShareLink, parseKeyFragment, parseShareLink, scrubShareLinks } from './link';

const k = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
const kb = toB64url(k);
const id = 'AbCdEfGh_ij-KLmnOP1234';

describe('share links', () => {
  test('build/parse round trip, base normalisation', () => {
    const link = buildShareLink('https://s.example.org/', id, k);
    expect(link).toBe(`https://s.example.org/s/${id}#k=${kb}`);
    expect(parseShareLink(link)).toEqual({ base: 'https://s.example.org', channelId: id, k });
    const prefixed = buildShareLink('http://10.0.2.2:8787/relay//', id, k);
    expect(prefixed).toBe(`http://10.0.2.2:8787/relay/s/${id}#k=${kb}`);
    expect(parseShareLink(prefixed)?.base).toBe('http://10.0.2.2:8787/relay');
  });
  test('app deep link', () => {
    const link = buildAppShareLink(id, k);
    expect(link).toBe(`pkuharness://share/${id}#k=${kb}`);
    expect(parseShareLink(link)).toEqual({ channelId: id, k });
  });
  test('tolerates whitespace, query, trailing slash and extra fragment params', () => {
    expect(parseShareLink(`  https://x.org/s/${id}/?utm=wx#k=${kb}&from=wechat \n`)?.channelId).toBe(id);
    expect(parseShareLink(`https://x.org/s/${id}#foo=1&k=${kb}`)?.k).toEqual(k);
  });
  test('rejects malformed links', () => {
    const bad = [
      `https://x.org/s/${id}`, // no fragment
      `https://x.org/s/${id}#`, // empty fragment
      `https://x.org/s/${id}#k=`, // empty key
      `https://x.org/s/${id}#k=${kb.slice(0, -2)}`, // short key
      `https://x.org/s/${id}#k=${kb}AA`, // long key
      `https://x.org/s/${id}#k=${kb.replace(/.$/, '+')}`, // bad alphabet
      `https://x.org/s/short#k=${kb}`, // id too short
      `https://x.org/s/${id}/extra#k=${kb}`, // trailing segment
      `https://x.org/x/${id}#k=${kb}`, // wrong path
      `ftp://x.org/s/${id}#k=${kb}`, // scheme
      `javascript://x.org/s/${id}#k=${kb}`,
      `pkuharness://other/${id}#k=${kb}`,
      `/s/${id}#k=${kb}`, // relative
      '',
    ];
    for (const l of bad) expect(parseShareLink(l)).toBeUndefined();
  });
  test('builders validate', () => {
    expect(() => buildShareLink('https://x.org', 'bad id!', k)).toThrow();
    expect(() => buildShareLink('https://x.org', id, new Uint8Array(16))).toThrow();
    expect(() => buildShareLink('https://x.org/?q=1', id, k)).toThrow();
    expect(() => buildShareLink('wss://x.org', id, k)).toThrow();
  });
  test('fragment parser', () => {
    expect(parseKeyFragment(`#k=${kb}`)).toEqual(k);
    expect(parseKeyFragment(`k=${kb}`)).toEqual(k);
    expect(parseKeyFragment('#kk=1')).toBeUndefined();
  });
  test('scrubber regex catches links in text', () => {
    const text = `看这个 ${buildShareLink('https://x.org', id, k)} 和 ${buildAppShareLink(id, k)}`;
    expect(text.replace(SHARE_LINK_SCRUB_RE, '[secret link]')).not.toContain(kb);
    const page = `https://x.org/w/card-share/view?c=${id}#from=s&k=${kb}`;
    expect(scrubShareLinks(`${text} ${page}`)).not.toContain(kb);
    expect(scrubShareLinks(page)).toBe(`https://x.org/w/card-share/view?c=${id}#from=s&k=[redacted]`);
    expect(scrubShareLinks('no links here #k=short')).toBe('no links here #k=short');
  });
});
