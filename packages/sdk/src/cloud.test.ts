import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { CloudError, defineCloudFunction, isCloudError, type CloudManifest } from './cloud';
import { definePlugin } from './plugin';

describe('cloud contract', () => {
  test('CloudError carries code and retryAfterS', () => {
    const e = new CloudError('rate_limited', 'slow down', 3);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('CloudError');
    expect(e.code).toBe('rate_limited');
    expect(e.retryAfterS).toBe(3);
    expect(isCloudError(e)).toBe(true);
    expect(isCloudError(e, 'offline')).toBe(false);
    expect(isCloudError(new Error('x'))).toBe(false);
  });
  test('defineCloudFunction keeps the zod types; manifests attach to plugins', () => {
    const fn = defineCloudFunction({ title: '回声', input: z.object({ s: z.string() }), output: z.string(), version: 1 });
    expect(fn.input.parse({ s: 'a' })).toEqual({ s: 'a' });
    const cloud: CloudManifest = { protocol: 1, uses: ['channels'], e2e: true, disclosure: { zh: ['加密后的数据经云服务转发'] }, functions: { echo: fn } };
    const p = definePlugin({ id: 'x-cloud', name: 'x', description: 'x', version: '0.0.0', scopes: [], tools: {}, requires: ['cloud'], cloud });
    expect(p.cloud?.uses).toEqual(['channels']);
  });
});
