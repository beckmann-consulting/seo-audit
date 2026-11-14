// ultimate-41, point 3: http to https, one case per row of the plan's table (B3).
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { Transport, Address } from '@/lib/ai-visibility/safe-fetch';
import { checkHttpToHttps, pickUrls } from './http-https';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';

const PUB: Address = { address: '93.184.215.14', family: 4 };

function transport(answer: (u: URL) => { status: number; location?: string } | 'fail') {
  const t: Transport = {
    resolve: host => Promise.resolve(/(^|\.)example\.com$/.test(host) || host === 'other.org' ? [PUB] : []),
    async request(url) {
      const a = answer(url);
      if (a === 'fail') throw new Error('connect ECONNREFUSED');
      return { status: a.status, headers: a.location ? { location: a.location } : { 'content-type': 'text/html' }, body: Readable.from([Buffer.from('')]) };
    },
  };
  return t;
}

const pages = [
  seoPage({ url: 'https://example.com/', depth: 0 }),
  seoPage({ url: 'https://example.com/b', depth: 1 }),
  seoPage({ url: 'https://example.com/a', depth: 1 }),
  seoPage({ url: 'https://example.com/c/d', depth: 2 }),
  seoPage({ url: 'https://example.com/z', depth: 1 }),
  seoPage({ url: 'https://example.com/gone', depth: 1, httpStatus: 404 }),
];
const run = (t: Transport, p = pages.slice(0, 2)) => checkHttpToHttps({ auditUrl: 'https://example.com/', pages: p, transport: t, deadline: Date.now() + 5000 });
const toHttps = (u: URL, status = 301) => ({ status, location: `https://example.com${u.pathname}` });

describe('http to https (ultimate-41, point 3)', () => {
  it('the start page and up to three subpages with status 200, by click depth, then alphabetically', () => {
    expect(pickUrls(pages)).toEqual(['https://example.com/', 'https://example.com/a', 'https://example.com/b', 'https://example.com/z']);
  });

  it('one 301 to the same HTTPS page with 200: passed', async () => {
    const r = await run(transport(u => u.protocol === 'http:' ? toHttps(u) : { status: 200 }));
    expect(r.findings).toEqual([]);
    expect(r.outcome.status).toBe('pass');
    expect(r.checks[0].result.steps.map(s => s.status)).toEqual([301, 200]);
  });

  it('one 301 straight to the final www URL is fine when that is the crawled page', async () => {
    const p = [seoPage({ url: 'https://www.example.com/', depth: 0 })];
    const r = await checkHttpToHttps({ auditUrl: 'https://www.example.com/', pages: p, deadline: Date.now() + 5000,
      transport: transport(u => u.protocol === 'http:' ? { status: 301, location: 'https://www.example.com/' } : { status: 200 }) });
    expect(r.outcome.status).toBe('pass');
  });

  it('http answers 200 without a redirect: important', async () => {
    const r = await run(transport(() => ({ status: 200 })));
    expect(r.findings.map(f => [f.code, f.priority])).toEqual([['tech.http-no-redirect', 'important']]);
  });

  it('302 and 307: temporary (recommended); 308: own optional finding, the point is not passed', async () => {
    const r = await run(transport(u => u.protocol === 'http:' ? toHttps(u, u.pathname === '/' ? 302 : 307) : { status: 200 }));
    expect(r.findings.map(f => f.code)).toEqual(['tech.http-redirect-temporary']);
    const r308 = await run(transport(u => u.protocol === 'http:' ? toHttps(u, 308) : { status: 200 }));
    expect(r308.findings.map(f => [f.code, f.priority])).toEqual([['tech.http-redirect-308', 'optional']]);
    expect(r308.outcome.status).toBe('fail');
  });

  it('more than one step to the 200: chain (recommended)', async () => {
    const r = await run(transport(u => {
      if (u.protocol === 'http:' && u.hostname === 'example.com') return { status: 301, location: `http://www.example.com${u.pathname}` };
      if (u.protocol === 'http:') return { status: 301, location: `https://example.com${u.pathname}` };
      return { status: 200 };
    }));
    expect(r.findings.map(f => f.code)).toEqual(['tech.http-redirect-chain']);
    expect(r.findings[0].description_en).toMatch(/301 → 301 → 200/);
  });

  it('wrong target: everything to the start page, to http, or to another domain', async () => {
    const home = await run(transport(u => u.protocol === 'http:' ? { status: 301, location: 'https://example.com/' } : { status: 200 }));
    expect(home.findings.map(f => f.code)).toEqual(['tech.http-redirect-wrong-target']);
    expect(home.findings[0].description_en).toMatch(/Affected \(1\): http:\/\/example\.com\/b/);
    const other = await run(transport(u => u.protocol === 'http:' ? { status: 301, location: `https://other.org${u.pathname}` } : { status: 200 }));
    expect(other.findings.map(f => f.code)).toEqual(['tech.http-redirect-wrong-target']);
  });

  it('port 80 not reachable: not checkable, no finding; a chain cut by the budget is not checkable either', async () => {
    const r = await run(transport(u => u.protocol === 'http:' ? 'fail' : { status: 200 }));
    expect(r.findings).toEqual([]);
    expect(r.outcome.status).toBe('not-checkable');
    const late = await checkHttpToHttps({ auditUrl: 'https://example.com/', pages: pages.slice(0, 1), deadline: Date.now() - 1, transport: transport(() => ({ status: 200 })) });
    expect(late.outcome.status).toBe('not-checkable');
  });

  it('no audit headers on the http variant', async () => {
    const seen: string[] = [];
    const t = transport(u => u.protocol === 'http:' ? toHttps(u) : { status: 200 });
    const spy: Transport = { resolve: t.resolve, request: (url, a, init) => { if (init.headers.authorization) seen.push(url.href); return t.request(url, a, init); } };
    await checkHttpToHttps({ auditUrl: 'https://example.com/', auditHeaders: { authorization: 'Basic eDp5' }, pages: pages.slice(0, 1), transport: spy, deadline: Date.now() + 5000 });
    expect(seen).toEqual(['https://example.com/']);
  });
});
