// The local render with a real Chromium (/usr/bin/chromium; skipped where it
// is missing) and a transport only this test passes in: it resolves the
// made-up public host site.test and answers from a table, so the address
// check of production runs unchanged and nothing leaves the machine.

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { localRender } from './local-render';
import { DEFAULT_LIMITS, type Transport } from './safe-fetch';

const CHROMIUM = '/usr/bin/chromium';
type Answer = { status?: number; headers?: Record<string, string>; body?: string };
const PAGE = (body: string, head = '') => `<!doctype html><html lang="de"><head><title>T</title>${head}</head><body>${body}</body></html>`;

function siteTransport(routes: Record<string, Answer | ((body?: string, headers?: Record<string, string>) => Answer)>): { t: Transport; hits: string[] } {
  const hits: string[] = [];
  const t: Transport = {
    async resolve(host) {
      if (host === 'site.test') return [{ address: '93.184.215.14', family: 4 }];
      throw new Error('ENOTFOUND');
    },
    async request(url, _address, init) {
      hits.push(`${init.method} ${url.pathname}${url.search}`);
      const r = routes[`${url.pathname}${url.search}`];
      const a = typeof r === 'function' ? r(init.body?.toString(), init.headers) : r ?? { status: 404, body: 'nf' };
      return { status: a.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...(a.headers ?? {}) }, body: Readable.from([Buffer.from(a.body ?? '')]) };
    },
  };
  return { t, hits };
}

const chromiumCount = () => {
  // "[c]hromium" matches the browser's command line but not this pgrep's own
  try { return Number(execSync(`pgrep -c -f '[c]hromium.*proxy-server=127\\.0\\.0\\.1:9' || true`).toString().trim() || '0'); } catch { return 0; }
};

describe.skipIf(!existsSync(CHROMIUM))('local render with a real Chromium', () => {
  it('serves every page from the transport, follows the document redirect, waits for quiet, refuses what it must', async () => {
    const js = (code: string) => ({ headers: { 'content-type': 'application/javascript' }, body: code });
    const { t, hits } = siteTransport({
      '/': { status: 301, headers: { location: '/de/' } },
      '/de/': { body: PAGE('<main id="m"><h1>Start</h1></main><script src="app.js"></script>') },
      '/de/app.js': js('document.getElementById("m").insertAdjacentHTML("beforeend", "<p id=loc>" + location.href + "</p>");'),
      '/img': { body: PAGE('<main><h1>Bild</h1><img src="https://cdn.other.test/x.png" onload="document.body.append(\'geladen\')"></main>') },
      '/foreign-js': { body: PAGE('<main><h1>Fremd</h1></main><script src="https://cdn.other.test/a.js"></script>') },
      '/remove': { body: PAGE('<main id="m"><h1>R</h1></main><script>document.getElementById("m").append("lokal hinzugefuegt")</script><script src="https://cdn.other.test/remove.js"></script>') },
      '/missing-js': { body: PAGE('<main><h1>M</h1></main><script src="/nope.js"></script>') },
      '/redirect-js': { body: PAGE('<main><h1>RJ</h1></main><script src="/old.js"></script>') },
      '/old.js': { status: 301, headers: { location: '/new.js' } },
      '/new.js': js('document.body.append("neu")'),
      '/post': { body: PAGE('<main id="m"><h1>P</h1></main><script>fetch("/api", {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({q: 7})}).then(r => r.text()).then(t => document.getElementById("m").append(t))</script>') },
      '/api': (body?: string) => ({ headers: { 'content-type': 'text/plain' }, body: `antwort-${body}` }),
      '/cookie': { headers: { 'set-cookie': 'sid=abc; Path=/' }, body: PAGE('<main id="m"><h1>C</h1></main><script>fetch("/who", {headers: {"x-token": "t1"}}).then(r => r.text()).then(t => document.getElementById("m").append(t))</script>') },
      '/who': (_b?: string, h?: Record<string, string>) => ({ headers: { 'content-type': 'text/plain' }, body: `who:${h?.cookie ?? '-'}:${h?.['x-token'] ?? '-'}` }),
      '/late': { body: PAGE('<main id="m"><h1>L</h1></main><script>addEventListener("load", () => setTimeout(() => fetch("/late.txt").then(r => r.text()).then(t => document.getElementById("m").append(t)), 300))</script>') },
      '/late.txt': { headers: { 'content-type': 'text/plain' }, body: 'spaet-geladen' },
      '/head': { body: PAGE('<main><h1>H</h1></main><script>setTimeout(() => document.querySelector("link[rel=canonical]").setAttribute("href", "/neu"), 600); setTimeout(() => document.querySelector("link[hreflang]").setAttribute("hreflang", "en-gb"), 1500); setInterval(() => document.body.classList.toggle("x"), 200)</script>', '<link rel="canonical" href="/alt"><link rel="alternate" hreflang="en" href="/en/">') },
      '/ws': { body: PAGE('<main><h1>W</h1></main><script>new WebSocket("wss://site.test/socket")</script>') },
      '/popup': { body: PAGE('<main><h1>Pop</h1></main><script>window.open("https://other.test/")</script>') },
    });
    const before = chromiumCount();
    const urls = ['/', '/img', '/foreign-js', '/remove', '/missing-js', '/redirect-js', '/post', '/cookie', '/late', '/head', '/ws', '/popup'].map(p => `https://site.test${p}`);
    const out = await localRender({ executablePath: CHROMIUM, auditUrl: 'https://site.test/', urls, transport: t, limits: { ...DEFAULT_LIMITS, pageTimeMs: 8000 }, quietMs: 1000 });
    const get = (p: string) => out.get(`https://site.test${p}`);

    // the document redirect: Chromium sees the final URL, the relative script ran
    expect(get('/')?.incompleteReason).toBeUndefined();
    expect(get('/')?.renderedHtml).toContain('<p id="loc">https://site.test/de/</p>');
    // foreign resources of any type make a page not assessable, in both directions
    expect(get('/img')?.incompleteReason).toMatch(/another host blocked \(cdn\.other\.test\)/);
    expect(get('/foreign-js')?.incompleteReason).toMatch(/another host blocked/);
    expect(get('/remove')?.incompleteReason).toMatch(/another host blocked/);
    // own resources missing or redirected
    expect(get('/missing-js')?.incompleteReason).toMatch(/HTTP 404/);
    expect(get('/redirect-js')?.incompleteReason).toMatch(/redirect of a resource not followed/);
    expect(hits).not.toContain('GET /new.js');
    // a POST body and a cookie-dependent XHR with its own header give the right DOM
    expect(get('/post')?.incompleteReason).toBeUndefined();
    expect(get('/post')?.renderedHtml).toContain('antwort-{"q":7}');
    expect(get('/cookie')?.renderedHtml).toContain('who:sid=abc:t1');
    // a fetch started 300 ms after load lands in the DOM
    expect(get('/late')?.renderedHtml).toContain('spaet-geladen');
    // head attributes changed at 600 and 1500 ms are both in the DOM; class changes do not keep it unquiet
    expect(get('/head')?.incompleteReason).toBeUndefined();
    expect(get('/head')?.renderedHtml).toContain('href="/neu"');
    expect(get('/head')?.renderedHtml).toContain('hreflang="en-gb"');
    // WebSockets are blocked; a popup is closed and does not count for the page
    expect(get('/ws')?.incompleteReason).toMatch(/WebSocket blocked/);
    expect(get('/popup')?.incompleteReason).toBeUndefined();
    // no Chromium of this test is left running
    expect(chromiumCount()).toBe(before);
  }, 120_000);

  it('a page that never gets quiet is not assessable', async () => {
    const { t } = siteTransport({
      '/busy': { body: PAGE('<main id="m"><h1>B</h1></main><script>setInterval(() => fetch("/tick").then(r => r.text()).then(t => document.getElementById("m").append(t)), 200)</script>') },
      '/tick': { headers: { 'content-type': 'text/plain' }, body: '.' },
    });
    const out = await localRender({ executablePath: CHROMIUM, auditUrl: 'https://site.test/', urls: ['https://site.test/busy'], transport: t, limits: { ...DEFAULT_LIMITS, pageTimeMs: 3000, pageRequests: 1000 }, quietMs: 1000 });
    expect(out.get('https://site.test/busy')?.incompleteReason).toMatch(/not quiet within the time budget/);
  }, 60_000);

  it('a renderer that blocks its main thread after load is stopped by the watchdog (Codex, review of bcfe8de, F-004)', async () => {
    const { t } = siteTransport({
      '/stuck': { body: PAGE('<main><h1>S</h1></main><script>addEventListener("load", () => { for (;;) {} })</script>') },
      '/stuck-later': { body: PAGE('<main><h1>S</h1></main><script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 300))</script>') },
    });
    const before = chromiumCount();
    const started = Date.now();
    const out = await localRender({ executablePath: CHROMIUM, auditUrl: 'https://site.test/', urls: ['https://site.test/stuck', 'https://site.test/stuck-later'], transport: t, limits: { ...DEFAULT_LIMITS, pageTimeMs: 3000 }, quietMs: 500 });
    expect(out.get('https://site.test/stuck')?.incompleteReason).toMatch(/time budget/);
    expect(out.get('https://site.test/stuck-later')?.incompleteReason).toMatch(/time budget/);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(chromiumCount()).toBe(before);
  }, 60_000);

  it('cookies of the document redirect chain reach Chromium with their attributes (Codex, review of bcfe8de, F-003)', async () => {
    const { t } = siteTransport({
      '/': { status: 302, headers: { location: '/de/', 'set-cookie': 'sid=s1; Path=/api' } },
      '/de/': (_b?: string, h?: Record<string, string>) => ({ headers: { 'set-cookie': 'lang=de; Path=/' }, body: PAGE(`<main id="m"><h1>Start ${h?.cookie ?? 'ohne'}</h1></main><script>Promise.all([fetch("/api/who").then(r => r.text()), fetch("/other/who").then(r => r.text())]).then(([a, b]) => document.getElementById("m").append(a + "|" + b))</script>`) }),
      '/api/who': (_b?: string, h?: Record<string, string>) => ({ headers: { 'content-type': 'text/plain' }, body: `api:${h?.cookie ?? '-'}` }),
      '/other/who': (_b?: string, h?: Record<string, string>) => ({ headers: { 'content-type': 'text/plain' }, body: `other:${h?.cookie ?? '-'}` }),
    });
    const out = await localRender({ executablePath: CHROMIUM, auditUrl: 'https://site.test/', urls: ['https://site.test/'], transport: t, quietMs: 500 });
    const r = out.get('https://site.test/');
    expect(r?.incompleteReason).toBeUndefined();
    // sid (Path=/api) went neither to the document /de/ nor to /other, but with /api
    expect(r?.renderedHtml).toContain('Start ohne');
    expect(r?.renderedHtml).toMatch(/api:(sid=s1; lang=de|lang=de; sid=s1)\|other:lang=de/);
  }, 60_000);

  it('a host that does not resolve to a public address is never rendered', async () => {
    const t: Transport = { resolve: async () => [{ address: '127.0.0.1', family: 4 }], request: async () => { throw new Error('must not be called'); } };
    const out = await localRender({ executablePath: CHROMIUM, auditUrl: 'https://site.test/', urls: ['https://site.test/'], transport: t });
    expect(out.get('https://site.test/')?.incompleteReason).toMatch(/non-public address/);
  });
});
