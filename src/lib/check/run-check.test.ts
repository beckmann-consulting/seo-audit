import { describe, expect, it } from 'vitest';
import { inLanguage, normaliseHost, runCheck, withoutDashes, CHECK_MODULES } from './run-check';
import { FakeNet, HOME_HTML, type FakeAnswer } from './fake-net';

const PUBLIC = '93.184.216.34';

function run(net: FakeNet, host: string, deadlineMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const started = Date.now();
  return runCheck(host, {
    signal: controller.signal, deadline: started + deadlineMs, transport: net.transport(controller.signal),
  }).finally(() => { clearTimeout(timer); controller.abort(); });
}

describe('normaliseHost', () => {
  it('takes a bare domain or a URL and refuses IPs, ports, credentials and junk', () => {
    expect(normaliseHost('Beispiel.de')).toBe('beispiel.de');
    expect(normaliseHost('https://www.beispiel.de/pfad?x=1')).toBe('www.beispiel.de');
    for (const bad of ['', 'localhost', '127.0.0.1', 'http://10.0.0.1/', '[::1]', 'beispiel.de:8080', 'user:pw@beispiel.de', 'bei spiel.de', 'a'.repeat(260) + '.de']) {
      expect(normaliseHost(bad)).toBeNull();
    }
  });
});

describe('runCheck: only public addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.10', '100.64.0.1', '::1', 'fc00::1']) {
    it(`refuses a host that resolves to ${address} without any request`, async () => {
      const net = new FakeNet({ 'intern.example': [address] }, () => ({ status: 200, body: HOME_HTML }));
      const r = await run(net, 'intern.example');
      expect(r).toEqual({ ok: false, error: 'refused' });
      expect(net.requested).toEqual([]);
    });
  }

  it('refuses a host with one public and one private address', async () => {
    const net = new FakeNet({ 'mixed.example': [PUBLIC, '10.0.0.5'] }, () => ({ status: 200, body: HOME_HTML }));
    expect(await run(net, 'mixed.example')).toEqual({ ok: false, error: 'refused' });
    expect(net.requested).toEqual([]);
  });

  it('does not follow a redirect to another domain, and skips a www twin with a private address', async () => {
    const net = new FakeNet(
      { 'site.example': [PUBLIC], 'www.site.example': ['10.0.0.9'], 'evil.example': ['127.0.0.1'] },
      url => url.pathname === '/'
        ? { status: 302, headers: { location: 'https://evil.example/' } }
        : { status: 404 },
    );
    const r = await run(net, 'site.example');
    expect(r).toEqual({ ok: false, error: 'unreachable' });
    expect(net.requested.every(x => x.endsWith(`@${PUBLIC}`))).toBe(true);
  });
});

describe('runCheck: deadline', () => {
  it('ends a hanging host at the deadline with no request left open', async () => {
    const net = new FakeNet({ 'slow.example': [PUBLIC], 'www.slow.example': [PUBLIC] }, () => ({ status: 200, hang: true }));
    const t0 = Date.now();
    const r = await run(net, 'slow.example', 300);
    const took = Date.now() - t0;
    expect(r).toEqual({ ok: false, error: 'timeout' });
    expect(net.open).toBe(0);
    expect(took).toBeGreaterThanOrEqual(290);
    expect(took).toBeLessThan(2000);
  });
});

describe('runCheck: a full run', () => {
  it('checks the start page and its legal pages and returns six areas without a PageSpeed key', async () => {
    const net = new FakeNet({ 'praxis.example': [PUBLIC], 'www.praxis.example': [PUBLIC] }, (url): FakeAnswer => {
      if (url.pathname === '/') return { status: 200, body: HOME_HTML, headers: { 'strict-transport-security': 'max-age=31536000' } };
      if (url.pathname === '/impressum' || url.pathname === '/datenschutz') return { status: 200, body: '<html><head><title>Rechtliches der Praxis</title></head><body><h1>Rechtliches</h1><p>Angaben gemäß § 5 DDG.</p></body></html>' };
      if (url.pathname === '/robots.txt') return { status: 200, body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } };
      return { status: 404, body: 'not found' };
    });
    const r = await run(net, 'praxis.example');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.pages).toBe(3);
    expect(r.result.performanceMeasured).toBe(false);
    expect(r.result.modules.map(m => m.module)).toEqual(CHECK_MODULES.filter(m => m !== 'performance'));
    expect(inLanguage(r.result, 'de').modules.find(m => m.module === 'legal')?.label).toBe('Rechtliche Basisangaben');
    expect(inLanguage(r.result, 'en').modules.find(m => m.module === 'legal')?.label).toBe('Basic legal information');
    expect(r.result.findings.every(f => f.de.title && f.en.title)).toBe(true);
    expect(r.result.findings.length).toBeLessThanOrEqual(3);
    expect(r.result.score).toBeGreaterThanOrEqual(0);
    expect(r.result.score).toBeLessThanOrEqual(100);
    expect(net.open).toBe(0);
    expect(net.requested.every(x => x.endsWith(`@${PUBLIC}`))).toBe(true);
  });
});

describe('withoutDashes', () => {
  it('turns ranges into hyphens and other dashes into commas', () => {
    expect(withoutDashes('Title auf 50\u201360 Zeichen ausbauen')).toBe('Title auf 50-60 Zeichen ausbauen');
    expect(withoutDashes('schnell \u2014 und sicher')).toBe('schnell, und sicher');
    expect(withoutDashes('Ende \u2013.')).toBe('Ende.');
    expect(withoutDashes('E-Mail und KI-unterstützt bleiben')).toBe('E-Mail und KI-unterstützt bleiben');
  });

  it('leaves no dash in a result', async () => {
    const net = new FakeNet({ 'praxis.example': [PUBLIC] }, (url): FakeAnswer =>
      url.pathname === '/' ? { status: 200, body: '<html><head><title>Kurz</title></head><body><h1>Hallo</h1></body></html>' } : { status: 404, body: '' });
    const r = await run(net, 'praxis.example');
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.stringify(r.result)).not.toMatch(/[\u2013\u2014]/);
  });
});
