import { describe, it, expect } from 'vitest';
import { classifyLlmsTxt } from './llms';

const U = 'https://example.com/llms.txt';

describe('classifyLlmsTxt (check 3: a note only)', () => {
  it('present and readable: 200, text, starts with "# "', () => {
    expect(classifyLlmsTxt(U, 200, 'text/plain; charset=utf-8', '# Example\n\n> A site\n').status).toBe('present-readable');
    expect(classifyLlmsTxt(U, 200, 'text/markdown', '﻿# Example\n').status).toBe('present-readable');
  });
  it('a soft 404 as HTML is present but not readable', () => {
    const i = classifyLlmsTxt(U, 200, 'text/html', '<!doctype html><title>Not found</title>');
    expect(i.status).toBe('present-unreadable');
    expect(i.reason).toMatch(/HTML/);
  });
  it('empty, or without a heading, is not readable', () => {
    expect(classifyLlmsTxt(U, 200, 'text/plain', '   ').status).toBe('present-unreadable');
    expect(classifyLlmsTxt(U, 200, 'text/plain', 'just text').status).toBe('present-unreadable');
  });
  it('404 and 410 mean absent; 5xx is an error (not reachable)', () => {
    expect(classifyLlmsTxt(U, 404, 'text/html', '').status).toBe('absent');
    expect(classifyLlmsTxt(U, 410, null, '').status).toBe('absent');
    expect(classifyLlmsTxt(U, 503, null, '').status).toBe('error');
  });
});

import { Readable } from 'node:stream';
import { fetchLlmsTxt, LLMS_MAX_BYTES } from './llms';
import type { Transport } from './safe-fetch';

function transport(answer: (path: string, host: string) => { status?: number; headers?: Record<string, string>; body?: Buffer }) {
  const calls: string[] = [];
  let bytesServed = 0;
  const t: Transport = {
    async resolve(host) {
      if (host === 'site.test' || host === 'www.site.test') return [{ address: '93.184.215.14', family: 4 }];
      if (host === 'inside.test') return [{ address: '10.0.0.7', family: 4 }];
      throw new Error('ENOTFOUND');
    },
    async request(url) {
      calls.push(`${url.host}${url.pathname}`);
      const a = answer(url.pathname, url.host);
      const body = a.body ?? Buffer.alloc(0);
      // serve in 64 kB pieces, counting what the reader pulled
      const pieces = Array.from({ length: Math.ceil(body.length / 65536) }, (_, i) => body.subarray(i * 65536, (i + 1) * 65536));
      const stream = Readable.from((function* () { for (const p of pieces) { bytesServed += p.length; yield p; } })());
      return { status: a.status ?? 200, headers: { 'content-type': 'text/plain', ...(a.headers ?? {}) }, body: stream };
    },
  };
  return { t, calls, served: () => bytesServed };
}

describe('fetchLlmsTxt: only the audited site, a bounded body (Codex, review of bcfe8de, F-001)', () => {
  it('present and readable, with llms-full.txt', async () => {
    const { t } = transport(path => (path === '/llms.txt' ? { body: Buffer.from('# Site\n') } : { status: 200 }));
    const i = await fetchLlmsTxt('https://site.test/de', { transport: t });
    expect(i).toMatchObject({ status: 'present-readable', hasFullTxt: true });
  });
  it('a redirect to another host or to an inside address is not followed', async () => {
    for (const location of ['https://other.test/llms.txt', 'https://inside.test/llms.txt', 'http://10.0.0.7/llms.txt']) {
      const { t, calls } = transport(() => ({ status: 301, headers: { location } }));
      const i = await fetchLlmsTxt('https://site.test/', { transport: t });
      expect(i.status, location).toBe('error');
      expect(calls, location).toEqual(['site.test/llms.txt']);
    }
  });
  it('an audited host that points inwards is not fetched at all', async () => {
    const { t, calls } = transport(() => ({ body: Buffer.from('# x') }));
    const i = await fetchLlmsTxt('https://inside.test/', { transport: t });
    expect(i.status).toBe('error');
    expect(calls).toHaveLength(0);
  });
  it('a huge answer is read only up to its cap', async () => {
    const big = Buffer.concat([Buffer.from('# Site\n'), Buffer.alloc(20 * 1024 * 1024, 'a')]);
    const { t, served } = transport(path => (path === '/llms.txt' ? { body: big } : { status: 404 }));
    const i = await fetchLlmsTxt('https://site.test/', { transport: t });
    expect(i.status).toBe('present-readable');
    expect(served()).toBeLessThanOrEqual(LLMS_MAX_BYTES + 65536);
  });
});
