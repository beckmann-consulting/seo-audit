// Subdomains in the local render (ultimate-40b, plan section 10): further hosts
// of the audited host's registrable domain under the same rules as the host
// itself. A transport only these tests pass in answers DNS and requests from a
// table; nothing leaves the machine.

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { buildScope, admit, safeFetch, CookieJar, DEFAULT_LIMITS, EXTRA_HOST_LIMIT, type Transport, type Address, type Scope } from './safe-fetch';

const PUB = (n = 14): Address => ({ address: `93.184.215.${n}`, family: 4 });

function transport(dns: Record<string, Address[] | 'hang' | 'fail'>) {
  const resolves: string[] = [];
  const calls: { url: string; address: string; headers: Record<string, string> }[] = [];
  const late: ((a: Address[]) => void)[] = [];
  const t: Transport = {
    resolve(host) {
      resolves.push(host);
      const d = dns[host];
      if (d === 'hang') return new Promise<Address[]>(r => { late.push(r); });
      if (!d || d === 'fail') return Promise.reject(new Error('ENOTFOUND'));
      return Promise.resolve(d);
    },
    async request(url, address, init) {
      calls.push({ url: url.href, address: address.address, headers: init.headers });
      const redirect = url.pathname === '/to-sub';
      return { status: redirect ? 302 : 200, headers: redirect ? { location: 'https://cdn.beckmanndigital.com/landing' } : { 'content-type': 'text/plain' }, body: Readable.from([Buffer.from('ok')]) };
    },
  };
  return { t, resolves, calls, late };
}

const SITE = { 'beckmanndigital.com': [PUB(14)], 'www.beckmanndigital.com': [PUB(15)] };
const budget = (ms = DEFAULT_LIMITS.pageTimeMs) => ({ bytesLeft: DEFAULT_LIMITS.pageBytes, deadline: Date.now() + ms });

async function scopeFor(t: Transport, url = 'https://beckmanndigital.com/de', subdomains = true, requestTimeoutMs?: number): Promise<Scope> {
  const r = await buildScope(url, t, { subdomains, requestTimeoutMs });
  if (!r.ok) throw new Error(r.reason);
  return r.scope;
}

describe('admit: hosts of the same registrable domain', () => {
  it('an allowed subdomain is resolved, checked and pinned; the request goes to its address', async () => {
    const { t, resolves, calls } = transport({ ...SITE, 'umami.beckmanndigital.com': [PUB(20)] });
    const scope = await scopeFor(t);
    expect(scope.site).toBe('beckmanndigital.com');
    const r = await safeFetch('https://umami.beckmanndigital.com/script.js', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: false });
    expect(r.ok).toBe(true);
    expect(calls.map(c => c.address)).toEqual(['93.184.215.20']);
    expect(resolves.filter(h => h === 'umami.beckmanndigital.com')).toHaveLength(1);
    // upper case is the same host and the same entry
    expect((await admit(scope, 'https://UMAMI.BeckmannDigital.com/x', Date.now() + 1000)).ok).toBe(true);
    expect(resolves.filter(h => h === 'umami.beckmanndigital.com')).toHaveLength(1);
  });

  it('another domain with the same beginning is refused without a lookup', async () => {
    const { t, resolves, calls } = transport({ ...SITE, 'beckmanndigital.com.evil.example': [PUB(30)], 'evilbeckmanndigital.com': [PUB(31)] });
    const scope = await scopeFor(t);
    for (const u of ['https://beckmanndigital.com.evil.example/a.js', 'https://evilbeckmanndigital.com/a.js', 'https://beckmanndigital.com./a.js']) {
      const r = await admit(scope, u, Date.now() + 1000);
      expect(r.ok, u).toBe(false);
    }
    expect(resolves).toEqual(['beckmanndigital.com', 'www.beckmanndigital.com']);
    expect(calls).toHaveLength(0);
  });

  it('a subdomain that points to a private address is refused, also the second time, without a request', async () => {
    const { t, resolves, calls } = transport({ ...SITE, 'intern.beckmanndigital.com': [{ address: '10.0.0.5', family: 4 }], 'lo.beckmanndigital.com': [PUB(21), { address: '127.0.0.1', family: 4 }], 'v6.beckmanndigital.com': [{ address: '::1', family: 6 }] });
    const scope = await scopeFor(t);
    for (const h of ['intern', 'lo', 'v6']) {
      const first = await safeFetch(`https://${h}.beckmanndigital.com/x`, { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: false });
      expect(first.ok, h).toBe(false);
      expect(!first.ok && first.reason, h).toMatch(/non-public address/);
      expect((await admit(scope, `https://${h}.beckmanndigital.com/y`, Date.now() + 1000)).ok).toBe(false);
    }
    expect(resolves.filter(h => h.startsWith('intern.'))).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('the public suffix boundary: two projects under github.io are two domains', async () => {
    const { t } = transport({ 'a.github.io': [PUB(40)], 'b.github.io': [PUB(41)], 'x.a.github.io': [PUB(42)] });
    const scope = await scopeFor(t, 'https://a.github.io/');
    expect(scope.site).toBe('a.github.io');
    expect((await admit(scope, 'https://b.github.io/x.js', Date.now() + 1000)).ok).toBe(false);
    expect((await admit(scope, 'https://x.a.github.io/x.js', Date.now() + 1000)).ok).toBe(true);
  });

  it('other scheme or port on a subdomain is refused; without subdomains (llms.txt) only host and counterpart count', async () => {
    const { t } = transport({ ...SITE, 'cdn.beckmanndigital.com': [PUB(22)] });
    const scope = await scopeFor(t);
    expect((await admit(scope, 'http://cdn.beckmanndigital.com/x', Date.now() + 1000)).ok).toBe(false);
    expect((await admit(scope, 'https://cdn.beckmanndigital.com:8443/x', Date.now() + 1000)).ok).toBe(false);
    const plain = await scopeFor(t, 'https://beckmanndigital.com/', false);
    expect(plain.site).toBeNull();
    expect((await admit(plain, 'https://cdn.beckmanndigital.com/x', Date.now() + 1000)).ok).toBe(false);
  });

  it('a host without a listed rule keeps the old rule of host and counterpart', async () => {
    const { t } = transport({ 'site.test': [PUB(14)], 'cdn.site.test': [PUB(15)] });
    const scope = await scopeFor(t, 'https://site.test/');
    expect(scope.site).toBeNull();
    expect((await admit(scope, 'https://cdn.site.test/x', Date.now() + 1000)).ok).toBe(false);
  });
});

describe('admit: slots, shared and timed resolutions (Codex F-002)', () => {
  it('ten parallel requests for a new host resolve it exactly once', async () => {
    const { t, resolves } = transport({ ...SITE, 'cdn.beckmanndigital.com': [PUB(22)] });
    const scope = await scopeFor(t);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => admit(scope, `https://cdn.beckmanndigital.com/${i}`, Date.now() + 1000)));
    expect(rs.every(r => r.ok)).toBe(true);
    expect(resolves.filter(h => h === 'cdn.beckmanndigital.com')).toHaveLength(1);
  });

  it('eleven failing hosts: ten take a slot and are resolved, the eleventh is refused without a lookup', async () => {
    const { t, resolves } = transport({ ...SITE });
    const scope = await scopeFor(t);
    for (let i = 1; i <= EXTRA_HOST_LIMIT + 1; i++) {
      const r = await admit(scope, `https://h${i}.beckmanndigital.com/x`, Date.now() + 1000);
      expect(r.ok).toBe(false);
      if (i <= EXTRA_HOST_LIMIT) expect(!r.ok && r.reason).toMatch(/does not resolve/);
      else expect(!r.ok && r.reason).toMatch(/more than 10 further hosts/);
    }
    expect(resolves.filter(h => h.startsWith('h'))).toHaveLength(EXTRA_HOST_LIMIT);
    // a refused host is not resolved again, and a good twelfth host gets no slot either
    await admit(scope, 'https://h1.beckmanndigital.com/y', Date.now() + 1000);
    expect(resolves.filter(h => h === 'h1.beckmanndigital.com')).toHaveLength(1);
    expect((await admit(scope, 'https://h12.beckmanndigital.com/x', Date.now() + 1000)).ok).toBe(false);
  });

  it('a resolution that never ends is refused at the page deadline; a late answer changes nothing', async () => {
    const { t, late } = transport({ ...SITE, 'slow.beckmanndigital.com': 'hang' });
    const scope = await scopeFor(t);
    const started = Date.now();
    const r = await admit(scope, 'https://slow.beckmanndigital.com/x', Date.now() + 300);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(2000);
    late.forEach(f => f([PUB(50)])); // the DNS answer arrives after the deadline
    await new Promise(res => setTimeout(res, 10));
    expect((await admit(scope, 'https://slow.beckmanndigital.com/y', Date.now() + 5000)).ok).toBe(false);
  });

  it('no time left: the host is refused without a lookup and stays refused (Codex, review of 58d270e)', async () => {
    const { t, resolves } = transport({ ...SITE, 'cdn.beckmanndigital.com': [PUB(22)] });
    const scope = await scopeFor(t);
    const r = await admit(scope, 'https://cdn.beckmanndigital.com/x', Date.now() - 1);
    expect(!r.ok && r.reason).toMatch(/timed out/);
    expect(resolves).not.toContain('cdn.beckmanndigital.com');
    expect((await admit(scope, 'https://cdn.beckmanndigital.com/y', Date.now() + 5000)).ok).toBe(false);
  });

  it('an answer that arrives after the deadline, before the timer fires, does not allow the host (Codex, review of 58d270e)', async () => {
    const t: Transport = {
      resolve(host) {
        if (host !== 'late.beckmanndigital.com') return Promise.resolve(SITE[host as keyof typeof SITE] ?? []);
        const end = Date.now() + 80; // the lookup blocks past the deadline, then its promise is already resolved
        while (Date.now() < end) { /* busy */ }
        return Promise.resolve([PUB(23)]);
      },
      async request() { throw new Error('no request expected'); },
    };
    const scope = await scopeFor(t);
    const r = await admit(scope, 'https://late.beckmanndigital.com/x', Date.now() + 20);
    expect(!r.ok && r.reason).toMatch(/timed out/);
    expect((await admit(scope, 'https://late.beckmanndigital.com/y', Date.now() + 5000)).ok).toBe(false);
  });

  it('the request timeout also bounds a resolution when the page has more time', async () => {
    const { t } = transport({ ...SITE, 'slow.beckmanndigital.com': 'hang' });
    const scope = await scopeFor(t, 'https://beckmanndigital.com/de', true, 200);
    const started = Date.now();
    expect((await admit(scope, 'https://slow.beckmanndigital.com/x', Date.now() + 20_000)).ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('headers, credentials and cookies with subdomains', () => {
  it('the audit headers and credentials reach the audited origin only, never a subdomain', async () => {
    const { t, calls } = transport({ ...SITE, 'cdn.beckmanndigital.com': [PUB(22)] });
    const scope = await scopeFor(t);
    const audit = { Authorization: 'Basic c2VjcmV0', 'X-Audit-Key': 'k1' };
    await safeFetch('https://beckmanndigital.com/a.js', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: false, auditHeaders: audit });
    await safeFetch('https://cdn.beckmanndigital.com/b.js', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: false, auditHeaders: audit });
    expect(calls[0].headers.authorization).toBe('Basic c2VjcmV0');
    expect(calls[0].headers['x-audit-key']).toBe('k1');
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(calls[1].headers['x-audit-key']).toBeUndefined();
  });

  it('a document redirect to a subdomain is checked and drops cookie and authorization of the page request', async () => {
    const { t, calls } = transport({ ...SITE, 'cdn.beckmanndigital.com': [PUB(22)] });
    const scope = await scopeFor(t);
    const r = await safeFetch('https://beckmanndigital.com/to-sub', { method: 'GET', headers: { cookie: 'sid=1', authorization: 'Bearer t' } }, { scope, transport: t, budget: budget(), document: true, auditHeaders: { 'X-Audit-Key': 'k1' } });
    expect(r.ok && r.res.finalUrl).toBe('https://cdn.beckmanndigital.com/landing');
    expect(calls[1].address).toBe('93.184.215.22');
    expect(calls[1].headers.cookie).toBeUndefined();
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(calls[1].headers['x-audit-key']).toBeUndefined();
  });

  it('cookies by their domain: a Domain cookie reaches the subdomain, a host-only cookie does not', () => {
    const jar = new CookieJar();
    jar.setFrom(new URL('https://beckmanndigital.com/'), 'site=1; Domain=.BeckmannDigital.COM; Path=/');
    jar.setFrom(new URL('https://beckmanndigital.com/'), 'host=1; Path=/');
    expect(jar.header(new URL('https://umami.beckmanndigital.com/x'))).toBe('site=1');
    expect(jar.header(new URL('https://beckmanndigital.com/x'))).toBe('site=1; host=1');
  });

  it('a Domain that is a public suffix is refused, or host-only on the suffix itself (RFC 6265 5.3 step 5)', () => {
    const jar = new CookieJar();
    jar.setFrom(new URL('https://beckmanndigital.com/'), 'a=1; Domain=com');
    jar.setFrom(new URL('https://a.github.io/'), 'b=1; Domain=github.io');
    jar.setFrom(new URL('https://bar.foo.ck/'), 'c=1; Domain=foo.ck');
    jar.setFrom(new URL('https://beckmanndigital.com/'), 'd=1; Domain=beckmanndigital.com.');
    expect(jar.size).toBe(0);
    jar.setFrom(new URL('https://foo.ck/'), 'e=1; Domain=foo.ck');
    expect(jar.header(new URL('https://foo.ck/'))).toBe('e=1');
    expect(jar.header(new URL('https://bar.foo.ck/'))).toBe('');
    jar.setFrom(new URL('https://a.www.ck/'), 'f=1; Domain=www.ck'); // !www.ck: www.ck is registrable
    expect(jar.header(new URL('https://www.ck/'))).toBe('f=1');
  });
});
