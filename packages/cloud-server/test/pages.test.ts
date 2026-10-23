import { afterEach, describe, expect, test } from 'bun:test';

import { paths } from '@pku-harness/cloud-protocol';

import { PAGE_CSP } from '../src/pages';
import { type TestServer, channelBody, json, makeServer, registerDevice, shareKeys, tokenFor } from './helpers';

let s: TestServer;
afterEach(() => s?.close());

describe('static plugin pages', () => {
  test('serves pages and assets with a strict CSP', async () => {
    s = await makeServer();
    const page = await s.request(paths.page('card-share', 'view'));
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('content-security-policy')).toBe(PAGE_CSP);
    expect(PAGE_CSP).toStartWith("default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'");
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await page.text()).toContain('<title>view</title>');
    const asset = await s.request('/w/card-share/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('content-security-policy')).toBe(PAGE_CSP);
  });

  test('never escapes web/dist', async () => {
    s = await makeServer();
    for (const p of ['/w/card-share/../secret.txt', '/w/card-share/%2e%2e/secret.txt', '/w/card-share/..%2Fsecret.txt', '/w/card-share/.hidden', '/w/wallet/view', '/w/card-share/nope'])
      expect((await s.request(p)).status).toBe(404);
  });

  test('GET /s/:id redirects to the channel page with only the id', async () => {
    s = await makeServer();
    const dev = await registerDevice(s);
    const token = await tokenFor(s, dev, 'card-share', ['channels']);
    const { id } = await json<{ id: string }>(await s.request(paths.channels(), { method: 'POST', token, json: channelBody(shareKeys(), { page: 'view' }) }));
    const r = await s.request(`${paths.shareRedirect(id)}?utm=evil&t=x`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`/w/card-share/view?c=${id}`);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await s.request(paths.shareRedirect('AAAAAAAAAAAAAAAAAAAAAA'))).status).toBe(404);
    // a channel without a page has nothing to redirect to
    const bare = await json<{ id: string }>(await s.request(paths.channels(), { method: 'POST', token, json: channelBody(shareKeys()) }));
    expect((await s.request(paths.shareRedirect(bare.id))).status).toBe(404);
  });
});
