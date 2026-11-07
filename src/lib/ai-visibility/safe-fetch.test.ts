import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import * as zlib from 'node:zlib';
import { buildScope, admit, isPublicAddress, safeFetch, fulfillHeaders, pinnedLookup, DEFAULT_LIMITS, type Transport, type Address, type RawResponse } from './safe-fetch';

const PUBLIC: Address = { address: '93.184.215.14', family: 4 };

function fakeTransport(dnsMap: Record<string, Address[]>, handler: (url: URL, address: Address, init: { method: string; headers: Record<string, string>; body?: Buffer }) => Partial<RawResponse> & { bodyBuf?: Buffer }) {
  const calls: { url: string; address: string; headers: Record<string, string>; method: string; body?: string }[] = [];
  const resolves: string[] = [];
  const t: Transport = {
    async resolve(host) {
      resolves.push(host);
      if (!dnsMap[host]) throw new Error('ENOTFOUND');
      return dnsMap[host];
    },
    async request(url, address, init) {
      calls.push({ url: url.href, address: address.address, headers: init.headers, method: init.method, body: init.body?.toString() });
      const r = handler(url, address, init);
      return { status: r.status ?? 200, headers: r.headers ?? {}, body: Readable.from([r.bodyBuf ?? Buffer.from('')]) };
    },
  };
  return { t, calls, resolves };
}

const budget = () => ({ bytesLeft: DEFAULT_LIMITS.pageBytes, deadline: Date.now() + DEFAULT_LIMITS.pageTimeMs });

describe('public addresses only', () => {
  it('rejects loopback, private, link-local, CGNAT, ULA, multicast, unspecified, IPv4 in IPv6, documentation', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '192.0.2.1', '::1', '::', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '2001:db8::1', 'not-an-ip']) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    expect(isPublicAddress('93.184.215.14')).toBe(true);
    expect(isPublicAddress('2606:2800:21f:cb07:6820:80da:af6b:8b2c')).toBe(true);
  });
});

describe('pinnedLookup', () => {
  it('answers with the checked address, as a list when Node asks with all: true', () => {
    const lookup = pinnedLookup({ address: '93.184.215.14', family: 4 });
    const got: unknown[][] = [];
    lookup('site.test', { all: true }, (...a) => got.push(a));
    lookup('site.test', {}, (...a) => got.push(a));
    lookup('site.test', 4, (...a) => got.push(a));
    expect(got).toEqual([[null, [{ address: '93.184.215.14', family: 4 }]], [null, '93.184.215.14', 4], [null, '93.184.215.14', 4]]);
  });
});

describe('buildScope', () => {
  it('the audited host and its www counterpart, pinned to their checked addresses', async () => {
    const { t } = fakeTransport({ 'site.test': [PUBLIC], 'www.site.test': [{ address: '93.184.215.15', family: 4 }] }, () => ({}));
    const r = await buildScope('https://site.test/de', t);
    expect(r.ok && [...r.scope.hosts.keys()]).toEqual(['site.test', 'www.site.test']);
  });
  it('a host that points to loopback (or any non-public address) is refused', async () => {
    const { t } = fakeTransport({ 'site.test': [PUBLIC, { address: '127.0.0.1', family: 4 }] }, () => ({}));
    const r = await buildScope('https://site.test/', t);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/non-public address \(127\.0\.0\.1\)/);
  });
  it('a private IP as the URL is refused; a counterpart pointing inwards is left out', async () => {
    expect((await buildScope('http://10.0.0.5/')).ok).toBe(false);
    const { t } = fakeTransport({ 'site.test': [PUBLIC], 'www.site.test': [{ address: '192.168.0.2', family: 4 }] }, () => ({}));
    const r = await buildScope('https://site.test/', t);
    expect(r.ok && [...r.scope.hosts.keys()]).toEqual(['site.test']);
  });
  it('admit: other scheme, port or host is outside', async () => {
    const { t } = fakeTransport({ 'site.test': [PUBLIC] }, () => ({}));
    const r = await buildScope('https://site.test/', t);
    if (!r.ok) throw new Error('scope');
    const d = Date.now() + 5000;
    expect((await admit(r.scope, 'https://site.test/a', d)).ok).toBe(true);
    expect((await admit(r.scope, 'http://site.test/a', d)).ok).toBe(false);
    expect((await admit(r.scope, 'https://site.test:8443/a', d)).ok).toBe(false);
    expect((await admit(r.scope, 'https://other.test/a', d)).ok).toBe(false);
    expect((await admit(r.scope, 'https://93.184.215.14/a', d)).ok).toBe(false);
  });
});

async function scopeWith(t: Transport, url = 'https://site.test/') {
  const r = await buildScope(url, t);
  if (!r.ok) throw new Error(r.reason);
  return r.scope;
}

describe('safeFetch', () => {
  const dnsMap = { 'site.test': [PUBLIC], 'www.site.test': [{ address: '93.184.215.15', family: 4 as const }] };

  it('the document follows a redirect on the same host, and every connection goes to the pinned address', async () => {
    const { t, calls, resolves } = fakeTransport(dnsMap, url => url.pathname === '/' ? { status: 301, headers: { location: '/de/' } } : { bodyBuf: Buffer.from('<html>de</html>'), headers: { 'content-type': 'text/html' } });
    const scope = await scopeWith(t);
    const r = await safeFetch('https://site.test/', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: true });
    expect(r.ok && r.res.finalUrl).toBe('https://site.test/de/');
    expect(calls.map(c => c.address)).toEqual(['93.184.215.14', '93.184.215.14']);
    expect(resolves).toEqual(['site.test', 'www.site.test']); // only while building the scope
  });

  it('a resource stops at its first redirect without contacting the target', async () => {
    const { t, calls } = fakeTransport(dnsMap, url => url.pathname === '/a.js' ? { status: 301, headers: { location: '/b.js' } } : { bodyBuf: Buffer.from('x') });
    const r = await safeFetch('https://site.test/a.js', { method: 'GET', headers: {} }, { scope: await scopeWith(t), transport: t, budget: budget(), document: false });
    expect(r.ok).toBe(false);
    expect(calls.map(c => c.url)).toEqual(['https://site.test/a.js']);
  });

  for (const status of [307, 308]) {
    it(`a POST with ${status} from www to apex is not followed; the target is not contacted`, async () => {
      const { t, calls } = fakeTransport(dnsMap, url => url.hostname === 'www.site.test' ? { status, headers: { location: 'https://site.test/api' } } : { bodyBuf: Buffer.from('{}') });
      const scope = await scopeWith(t, 'https://www.site.test/');
      const r = await safeFetch('https://www.site.test/api', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'sid=1' }, body: Buffer.from('{"q":1}') }, { scope, transport: t, budget: budget(), document: false });
      expect(r.ok).toBe(false);
      expect(calls.filter(c => c.url.startsWith('https://site.test/'))).toHaveLength(0);
    });
  }

  it('a POST body and its cookie and own header reach the site', async () => {
    const { t, calls } = fakeTransport(dnsMap, (_u, _a, init) => ({ bodyBuf: Buffer.from(`echo ${init.body?.toString()} ${init.headers.cookie} ${init.headers['x-token']}`) }));
    const r = await safeFetch('https://site.test/api', { method: 'POST', headers: { cookie: 'sid=1', 'x-token': 't', 'content-type': 'application/json', connection: 'keep-alive', host: 'evil' }, body: Buffer.from('{"q":1}') }, { scope: await scopeWith(t), transport: t, budget: budget(), document: false });
    expect(r.ok && r.res.body.toString()).toBe('echo {"q":1} sid=1 t');
    expect(calls[0].headers.connection).toBeUndefined();
    expect(calls[0].headers.host).toBeUndefined();
    expect(calls[0].headers['accept-encoding']).toBe('identity');
  });

  it('PUT is not reproducible', async () => {
    const { t, calls } = fakeTransport(dnsMap, () => ({}));
    const r = await safeFetch('https://site.test/api', { method: 'PUT', headers: {} }, { scope: await scopeWith(t), transport: t, budget: budget(), document: false });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a document redirect from www to apex drops cookie, authorization and the audit headers', async () => {
    const { t, calls } = fakeTransport(dnsMap, url => url.hostname === 'www.site.test' ? { status: 302, headers: { location: 'https://site.test/' } } : { bodyBuf: Buffer.from('ok') });
    const scope = await scopeWith(t, 'https://www.site.test/');
    const r = await safeFetch('https://www.site.test/', { method: 'GET', headers: { cookie: 'sid=1', authorization: 'Basic x' } }, { scope, transport: t, budget: budget(), document: true, auditHeaders: { 'X-Audit': 'a' } });
    expect(r.ok).toBe(true);
    expect(calls[0].headers).toMatchObject({ cookie: 'sid=1', authorization: 'Basic x', 'x-audit': 'a' });
    expect(calls[1].headers.cookie).toBeUndefined();
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(calls[1].headers['x-audit']).toBeUndefined();
  });

  it('redirects to an IP or a foreign host are refused', async () => {
    for (const location of ['https://10.0.0.1/', 'https://93.184.215.14/', 'https://other.test/']) {
      const { t, calls } = fakeTransport(dnsMap, () => ({ status: 302, headers: { location } }));
      const r = await safeFetch('https://site.test/', { method: 'GET', headers: {} }, { scope: await scopeWith(t), transport: t, budget: budget(), document: true });
      expect(r.ok, location).toBe(false);
      expect(calls).toHaveLength(1);
    }
  });

  it('small gzip, deflate and brotli answers arrive unpacked, without the encoding and length headers of the source', async () => {
    const text = '<html>klein</html>';
    for (const [enc, buf] of [['gzip', zlib.gzipSync(text)], ['deflate', zlib.deflateSync(text)], ['br', zlib.brotliCompressSync(text)]] as const) {
      const { t } = fakeTransport(dnsMap, () => ({ bodyBuf: buf, headers: { 'content-encoding': enc, 'content-length': String(buf.length), 'transfer-encoding': 'chunked', 'content-type': 'text/html' } }));
      const r = await safeFetch('https://site.test/', { method: 'GET', headers: {} }, { scope: await scopeWith(t), transport: t, budget: budget(), document: true });
      expect(r.ok && r.res.body.toString(), enc).toBe(text);
      expect(r.ok && r.res.headers).toEqual({ 'content-type': 'text/html' });
    }
  });

  it('a gzip or brotli answer over 5 MB unpacked is cut off, also when small compressed', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 'a');
    for (const [enc, buf] of [['gzip', zlib.gzipSync(big)], ['br', zlib.brotliCompressSync(big)]] as const) {
      expect(buf.length).toBeLessThan(100_000);
      const { t } = fakeTransport(dnsMap, () => ({ bodyBuf: buf, headers: { 'content-encoding': enc } }));
      const r = await safeFetch('https://site.test/', { method: 'GET', headers: {} }, { scope: await scopeWith(t), transport: t, budget: budget(), document: true });
      expect(r.ok, enc).toBe(false);
      expect(!r.ok && r.reason).toMatch(/over 5242880 bytes \(unpacked\)/);
    }
  });

  it('the byte budget of the page counts across requests', async () => {
    const { t } = fakeTransport(dnsMap, () => ({ bodyBuf: Buffer.alloc(4 * 1024 * 1024, 'b') }));
    const scope = await scopeWith(t);
    const b = budget();
    for (let i = 0; i < 3; i++) expect((await safeFetch(`https://site.test/${i}`, { method: 'GET', headers: {} }, { scope, transport: t, budget: b, document: false })).ok).toBe(true);
    const fourth = await safeFetch('https://site.test/3', { method: 'GET', headers: {} }, { scope, transport: t, budget: b, document: false });
    expect(!fourth.ok && fourth.reason).toMatch(/byte budget/);
  });

  it('fulfillHeaders keeps Set-Cookie and drops hop-by-hop headers', () => {
    expect(fulfillHeaders({ 'set-cookie': ['a=1', 'b=2'], connection: 'close', 'content-type': 'text/html', 'content-length': '5' })).toEqual({ 'set-cookie': 'a=1\nb=2', 'content-type': 'text/html' });
  });
});

describe('audit headers only for the audited origin (Codex, review of bcfe8de, F-002)', () => {
  const dnsMap = { 'site.test': [PUBLIC], 'www.site.test': [{ address: '93.184.215.15', family: 4 as const }] };
  it('an apex audit sends its headers to the apex only, not to a resource on www', async () => {
    const { t, calls } = fakeTransport(dnsMap, () => ({ bodyBuf: Buffer.from('x') }));
    const scope = await scopeWith(t, 'https://site.test/');
    const audit = { Authorization: 'Basic c2VjcmV0', 'X-Audit': 'a' };
    await safeFetch('https://site.test/a.js', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: false, auditHeaders: audit });
    await safeFetch('https://www.site.test/b.js', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: false, auditHeaders: audit });
    expect(calls[0].headers).toMatchObject({ authorization: 'Basic c2VjcmV0', 'x-audit': 'a' });
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(calls[1].headers['x-audit']).toBeUndefined();
  });
  it('audit headers cannot set Host, Accept-Encoding or a length', async () => {
    const { t, calls } = fakeTransport(dnsMap, () => ({ bodyBuf: Buffer.from('x') }));
    const scope = await scopeWith(t, 'https://site.test/');
    await safeFetch('https://site.test/', { method: 'GET', headers: {} }, { scope, transport: t, budget: budget(), document: true, auditHeaders: { Host: 'evil.test', 'Accept-Encoding': 'gzip', 'Content-Length': '9', Connection: 'upgrade', 'X-Ok': '1' } });
    expect(calls[0].headers.host).toBeUndefined();
    expect(calls[0].headers['accept-encoding']).toBe('identity');
    expect(calls[0].headers['content-length']).toBeUndefined();
    expect(calls[0].headers.connection).toBeUndefined();
    expect(calls[0].headers['x-ok']).toBe('1');
  });
});

describe('cookie jar of the document redirect chain (Codex, review of bcfe8de, F-003)', () => {
  const dnsMap = { 'site.test': [PUBLIC], 'www.site.test': [{ address: '93.184.215.15', family: 4 as const }] };
  it('a cookie set on one step goes with the next; attributes decide where', async () => {
    const { t, calls } = fakeTransport(dnsMap, (url, _a, init) => {
      if (url.pathname === '/') return { status: 302, headers: { location: '/login', 'set-cookie': ['a=1; Path=/', 'b=2; Path=/admin', 'c=3; Domain=site.test; Path=/', 'd=4; Secure'] } };
      if (url.pathname === '/login') return { status: 302, headers: { location: 'https://www.site.test/de/', 'set-cookie': 'e=5; Max-Age=0; Path=/' } };
      return { bodyBuf: Buffer.from(`cookies:${init.headers.cookie ?? ''}`) };
    });
    const { CookieJar } = await import('./safe-fetch');
    const jar = new CookieJar();
    const r = await safeFetch('https://site.test/', { method: 'GET', headers: {} }, { scope: await scopeWith(t), transport: t, budget: budget(), document: true, jar });
    expect(calls[1].headers.cookie).toContain('a=1');
    expect(calls[1].headers.cookie).toContain('c=3');
    expect(calls[1].headers.cookie).toContain('d=4');
    expect(calls[1].headers.cookie).not.toContain('b=2'); // path /admin
    // on www: only the Domain cookie (host-only cookies of the apex stay there)
    expect(r.ok && r.res.body.toString()).toBe('cookies:c=3');
    const pw = jar.forPlaywright();
    expect(pw.find(c => c.name === 'c')).toMatchObject({ domain: '.site.test', path: '/' });
    expect(pw.find(c => c.name === 'a')).toMatchObject({ domain: 'site.test', path: '/' });
    expect(pw.find(c => c.name === 'd')).toMatchObject({ secure: true });
    expect(pw.find(c => c.name === 'e')).toBeUndefined();
  });
  it('a Domain the host is not in is refused', async () => {
    const { CookieJar } = await import('./safe-fetch');
    const jar = new CookieJar();
    jar.setFrom(new URL('https://site.test/'), 'x=1; Domain=other.test');
    expect(jar.size).toBe(0);
  });
});
