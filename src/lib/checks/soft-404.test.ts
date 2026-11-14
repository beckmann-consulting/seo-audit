// ultimate-41, point 2: the made-up URL, one case per row of the plan's table (B2) and the language path.
import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { Transport, Address } from '@/lib/ai-visibility/safe-fetch';
import { checkSoft404, probeUrls, isOwn404Page } from './soft-404';

const PUB: Address = { address: '93.184.215.14', family: 4 };
const OWN_404 = `<html><head><title>Seite nicht gefunden</title></head><body><h1>Diese Seite gibt es nicht</h1>
<p>Die gesuchte Adresse ist nicht vorhanden oder wurde verschoben. Von hier aus geht es zur Startseite, zu unseren Leistungen oder zum Kontakt mit allen Wegen zu uns.</p>
<a href="/">Startseite</a></body></html>`;
const APACHE_404 = '<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>';

function transport(answer: (u: URL) => { status: number; location?: string; body?: string; type?: string } | 'fail') {
  const urls: string[] = [];
  const t: Transport = {
    resolve: host => Promise.resolve(host.endsWith('example.com') ? [PUB] : []),
    async request(url) {
      urls.push(url.href);
      const a = answer(url);
      if (a === 'fail') throw new Error('connect ECONNREFUSED');
      const headers: Record<string, string> = { 'content-type': a.type ?? 'text/html; charset=utf-8' };
      if (a.location) headers.location = a.location;
      return { status: a.status, headers, body: Readable.from([Buffer.from(a.body ?? '')]) };
    },
  };
  return { t, urls };
}

const base = { auditUrl: 'https://example.com/de', startUrl: 'https://example.com/de', token: 'abcd1234' };
const run = (t: Transport) => checkSoft404({ ...base, transport: t, deadline: Date.now() + 5000 });

describe('soft-404 (ultimate-41, point 2)', () => {
  it('two probes: the root and the first path segment', () => {
    expect(probeUrls('https://example.com/de/', 'x')).toEqual(['https://example.com/seo-audit-404-check-x', 'https://example.com/de/seo-audit-404-check-x']);
    expect(probeUrls('https://example.com/', 'x')).toEqual(['https://example.com/seo-audit-404-check-x']);
    expect(probeUrls('https://example.com/index.html', 'x')).toEqual(['https://example.com/seo-audit-404-check-x']);
  });

  it('404 with an own page: passed', async () => {
    const { t, urls } = transport(() => ({ status: 404, body: OWN_404 }));
    const r = await run(t);
    expect(urls).toEqual(['https://example.com/seo-audit-404-check-abcd1234', 'https://example.com/de/seo-audit-404-check-abcd1234']);
    expect(r.findings).toEqual([]);
    expect(r.outcome.status).toBe('pass');
  });

  it('404 with the server default page: no custom 404 page (optional); 410 counts like 404', async () => {
    const { t } = transport(u => ({ status: u.pathname.startsWith('/de/') ? 410 : 404, body: APACHE_404 }));
    const r = await run(t);
    expect(r.findings.map(f => [f.code, f.priority])).toEqual([['tech.no-custom-404', 'optional']]);
    expect(r.outcome.status).toBe('fail');
  });

  it('200 is a soft 404 (important); a SPA fallback only on the language path is found too', async () => {
    const { t } = transport(u => u.pathname.startsWith('/de/') ? { status: 200, body: '<html><title>App</title></html>' } : { status: 404, body: OWN_404 });
    const r = await run(t);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ code: 'tech.soft-404', priority: 'important', affectedUrl: 'https://example.com/de/seo-audit-404-check-abcd1234' });
  });

  it('3xx is a soft-404 redirect (recommended), naming the target; it is not followed', async () => {
    const { t, urls } = transport(() => ({ status: 301, location: 'https://example.com/' }));
    const r = await run(t);
    expect(r.findings.map(f => f.code)).toEqual(['tech.soft-404-redirect']);
    expect(r.findings[0].description_en).toMatch(/→ https:\/\/example\.com\/ \(301\)/);
    expect(urls).toHaveLength(2);
  });

  it('5xx (recommended) and another 4xx (optional)', async () => {
    const { t } = transport(u => u.pathname.startsWith('/de/') ? { status: 403 } : { status: 500 });
    const r = await run(t);
    expect(r.findings.map(f => [f.code, f.priority])).toEqual([['tech.404-probe-server-error', 'recommended'], ['tech.404-probe-status', 'optional']]);
  });

  it('no answer: not checkable, no finding and never passed', async () => {
    const { t } = transport(() => 'fail');
    const r = await run(t);
    expect(r.findings).toEqual([]);
    expect(r.outcome.status).toBe('not-checkable');
    const { t: half } = transport(u => u.pathname.startsWith('/de/') ? 'fail' : { status: 404, body: OWN_404 });
    expect((await run(half)).outcome.status).toBe('not-checkable');
  });

  it('isOwn404Page needs HTML, a title, 20 words and a link to the site', () => {
    expect(isOwn404Page(Buffer.from(OWN_404), 'text/html', 'https://www.example.com/x')).toBe(true);
    expect(isOwn404Page(Buffer.from(OWN_404), 'text/plain', 'https://example.com/x')).toBe(false);
    expect(isOwn404Page(Buffer.from(OWN_404.replace('<a href="/">Startseite</a>', '<a href="https://other.org/">x</a>')), 'text/html', 'https://example.com/x')).toBe(false);
    expect(isOwn404Page(Buffer.from(APACHE_404), 'text/html', 'https://example.com/x')).toBe(false);
  });
});
