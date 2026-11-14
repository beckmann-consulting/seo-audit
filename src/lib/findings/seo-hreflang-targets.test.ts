// ultimate-41, point 6: status and canonical of every hreflang target, with a fixed budget of requests and time.
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { Transport, Address } from '@/lib/ai-visibility/safe-fetch';
import { checkHreflangTargets, headSignals } from '@/lib/checks/hreflang-targets';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';

const PUB: Address = { address: '93.184.215.14', family: 4 };
const DE = 'https://example.com/de';
const EN = 'https://example.com/en';

function transport(answer: (u: URL) => { status: number; location?: string; body?: string; headers?: Record<string, string> } | 'fail', delayMs = 0, dns: 'ok' | 'never' = 'ok') {
  const calls: { url: string; at: number; auth: boolean }[] = [];
  const t: Transport = {
    resolve: () => (dns === 'never' ? new Promise(() => {}) : Promise.resolve([PUB])),
    async request(url, _a, init) {
      calls.push({ url: url.href, at: Date.now(), auth: Boolean(init.headers.authorization) });
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      const a = answer(url);
      if (a === 'fail') throw new Error('connect ECONNREFUSED');
      const headers: Record<string, string> = { 'content-type': 'text/html', ...(a.headers ?? {}) };
      if (a.location) headers.location = a.location;
      return { status: a.status, headers, body: Readable.from([Buffer.from(a.body ?? '')]) };
    },
  };
  return { t, calls };
}

const page = (url: string, hreflangs: { hreflang: string; href: string }[], extra = {}) => seoPage({ url, hreflangs, canonicalUrl: url, ...extra });

describe('hreflang targets (ultimate-41, point 6)', () => {
  it('crawled targets come from the crawl, without a request: all fine → passed', async () => {
    const hl = [{ hreflang: 'de', href: DE }, { hreflang: 'en', href: EN }, { hreflang: 'x-default', href: DE }];
    const { t, calls } = transport(() => ({ status: 200 }));
    const r = await checkHreflangTargets({ pages: [page(DE, hl), page(EN, hl)], httpErrors: [], transport: t, deadline: Date.now() + 5000 });
    expect(calls).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.outcome.status).toBe('pass');
  });

  it('crawled: an error page (important), a redirect source, noindex and a foreign canonical (recommended)', async () => {
    const hl = [{ hreflang: 'de', href: DE }, { hreflang: 'en', href: EN }, { hreflang: 'fr', href: 'https://example.com/fr' }, { hreflang: 'it', href: 'https://example.com/it-old' }, { hreflang: 'es', href: 'https://example.com/es' }];
    const pages = [
      page(DE, hl),
      page(EN, hl, { hasNoindex: true }),
      page('https://example.com/it', [], { redirectChain: ['https://example.com/it-old'] }),
      page('https://example.com/es', [], { canonicalUrl: 'https://example.com/es/start' }),
    ];
    const r = await checkHreflangTargets({ pages, httpErrors: [{ url: 'https://example.com/fr', status: 404 }], transport: transport(() => ({ status: 200 })).t, deadline: Date.now() + 5000 });
    expect(r.findings.map(f => [f.code, f.priority])).toEqual([
      ['seo.hreflang-target-error', 'important'], ['seo.hreflang-target-redirect', 'recommended'],
      ['seo.hreflang-target-noindex', 'recommended'], ['seo.hreflang-target-not-canonical', 'recommended'],
    ]);
    expect(r.outcome.status).toBe('fail');
  });

  it('targets outside the crawl are fetched once, other domains too, without the audit credentials', async () => {
    const hl = [{ hreflang: 'de', href: DE }, { hreflang: 'en', href: 'https://example.co.uk/' }, { hreflang: 'fr', href: 'https://example.fr/' }];
    const { t, calls } = transport(u => u.hostname === 'example.co.uk'
      ? { status: 200, body: '<html><head><link rel="canonical" href="https://example.co.uk/home"></head></html>' }
      : { status: 301, location: 'https://www.example.fr/' });
    const r = await checkHreflangTargets({ pages: [page(DE, hl)], httpErrors: [], transport: t, deadline: Date.now() + 5000 });
    expect(calls.map(c => c.url).sort()).toEqual(['https://example.co.uk/', 'https://example.fr/']);
    expect(calls.every(c => !c.auth)).toBe(true);
    expect(r.findings.map(f => f.code)).toEqual(['seo.hreflang-target-redirect', 'seo.hreflang-target-not-canonical']);
  });

  it('a failed fetch makes the point not checkable when nothing else is wrong', async () => {
    const hl = [{ hreflang: 'de', href: DE }, { hreflang: 'en', href: 'https://example.co.uk/' }];
    const r = await checkHreflangTargets({ pages: [page(DE, hl)], httpErrors: [], transport: transport(() => 'fail').t, deadline: Date.now() + 5000 });
    expect(r.findings).toEqual([]);
    expect(r.outcome.status).toBe('not-checkable');
    expect(r.outcome.summary_en).toMatch(/1 failed, 0 not started/);
  });

  it('load: 5 000 targets, the transport answers at once: exactly 300 requests, 4 700 not started, never passed', async () => {
    const hl = Array.from({ length: 5000 }, (_, i) => ({ hreflang: 'en', href: `https://t${i}.example.org/` }));
    const { t, calls } = transport(() => ({ status: 200 }));
    const r = await checkHreflangTargets({ pages: [page(DE, hl)], httpErrors: [], transport: t, deadline: Date.now() + 60_000, maxRequests: 300 });
    expect(calls).toHaveLength(300);
    expect(r.requests).toBe(300);
    expect([...r.states.values()].filter(s => s.kind === 'not-started')).toHaveLength(4700);
    expect(r.outcome.status).toBe('not-checkable');
  });

  it('load: 1 000 slow targets and a 1 s budget: no request starts after the deadline', async () => {
    const hl = Array.from({ length: 1000 }, (_, i) => ({ hreflang: 'en', href: `https://s${i}.example.org/` }));
    const { t, calls } = transport(() => ({ status: 200 }), 200);
    const deadline = Date.now() + 1000;
    const r = await checkHreflangTargets({ pages: [page(DE, hl)], httpErrors: [], transport: t, deadline });
    expect(calls.length).toBeGreaterThan(0);
    // the time is checked right before each request; between that check and the transport call only the event loop
    // runs, so a request may start a few milliseconds after it under load, never a whole request later
    expect(calls.every(c => c.at < deadline + 50)).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(4 * Math.ceil(1000 / 200) + 4);
    expect(Date.now() - deadline).toBeLessThan(1000);
    expect(r.outcome.status).toBe('not-checkable');
  });

  it('a resolver that never answers: the workers return at the deadline, no request is made', async () => {
    const hl = [{ hreflang: 'en', href: 'https://example.co.uk/' }, { hreflang: 'fr', href: 'https://example.fr/' }];
    const { t, calls } = transport(() => ({ status: 200 }), 0, 'never');
    const t0 = Date.now();
    const r = await checkHreflangTargets({ pages: [page(DE, hl)], httpErrors: [], transport: t, deadline: t0 + 150 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(calls).toEqual([]);
    expect(r.outcome.status).toBe('not-checkable');
  });

  it('headSignals: canonical from the link tag or the Link header, noindex from meta or X-Robots-Tag', () => {
    expect(headSignals(Buffer.from('<link rel="canonical" href="/a">'), {})).toEqual({ canonical: '/a', noindex: false });
    expect(headSignals(Buffer.from(''), { link: '<https://x.org/b>; rel="canonical"' })).toEqual({ canonical: 'https://x.org/b', noindex: false });
    expect(headSignals(Buffer.from('<meta name="robots" content="noindex,follow">'), {}).noindex).toBe(true);
    expect(headSignals(Buffer.from(''), { 'x-robots-tag': 'noindex' }).noindex).toBe(true);
  });
});
