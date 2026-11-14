import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { Transport, Address } from '@/lib/ai-visibility/safe-fetch';
import { probeChain } from './probe';

const PUB: Address = { address: '93.184.215.14', family: 4 };
const PUB2: Address = { address: '93.184.215.15', family: 4 };

interface Call { url: string; address: string; headers: Record<string, string>; at: number }

function transport(dns: Record<string, Address[] | 'never'>, answer: (url: URL) => { status: number; location?: string; body?: string }) {
  const calls: Call[] = [];
  const t: Transport = {
    resolve(host) {
      const a = dns[host];
      if (a === 'never') return new Promise(() => {});
      if (!a) return Promise.reject(new Error('ENOTFOUND'));
      return Promise.resolve(a);
    },
    async request(url, address, init) {
      calls.push({ url: url.href, address: address.address, headers: init.headers, at: Date.now() });
      const r = answer(url);
      return { status: r.status, headers: r.location ? { location: r.location } : { 'content-type': 'text/html' }, body: Readable.from([Buffer.from(r.body ?? '')]) };
    },
  };
  return { t, calls };
}

const soon = () => Date.now() + 5_000;
const AUDIT = 'https://example.com/';
const AUTH = { authorization: 'Basic dXNlcjpwYXNz' };

describe('probeChain (ultimate-41, plan 1.3)', () => {
  it('http → https → 200 on the same host, every step recorded with status and Location', async () => {
    const { t, calls } = transport({ 'example.com': [PUB], 'www.example.com': [PUB2] },
      u => u.protocol === 'http:' ? { status: 301, location: `https://example.com${u.pathname}` } : { status: 200, body: '<title>x</title>' });
    const r = await probeChain('http://example.com/a', { auditUrl: AUDIT, transport: t, deadline: soon() });
    expect(r.stopped).toBeUndefined();
    expect(r.steps).toEqual([
      { url: 'http://example.com/a', status: 301, location: 'https://example.com/a' },
      { url: 'https://example.com/a', status: 200 },
    ]);
    expect(r.final?.body.toString()).toBe('<title>x</title>');
    expect(calls.map(c => c.address)).toEqual(['93.184.215.14', '93.184.215.14']);
  });

  it('http://apex → https://www → 200, the www step pinned to its own address', async () => {
    const { t, calls } = transport({ 'example.com': [PUB], 'www.example.com': [PUB2] },
      u => u.hostname === 'example.com' ? { status: 301, location: `https://www.example.com${u.pathname}` } : { status: 200 });
    const r = await probeChain('http://example.com/', { auditUrl: AUDIT, transport: t, deadline: soon() });
    expect(r.steps.map(s => [s.url, s.status])).toEqual([['http://example.com/', 301], ['https://www.example.com/', 200]]);
    expect(calls[1].address).toBe('93.184.215.15');
  });

  it('http://apex → http://www → https://www → 200: two steps before the answer', async () => {
    const { t } = transport({ 'example.com': [PUB], 'www.example.com': [PUB2] }, u => {
      if (u.protocol === 'http:' && u.hostname === 'example.com') return { status: 301, location: 'http://www.example.com/' };
      if (u.protocol === 'http:') return { status: 301, location: 'https://www.example.com/' };
      return { status: 200 };
    });
    const r = await probeChain('http://example.com/', { auditUrl: AUDIT, transport: t, deadline: soon() });
    expect(r.steps.map(s => s.status)).toEqual([301, 301, 200]);
    expect(r.final?.url).toBe('https://www.example.com/');
  });

  it('a step to a host with a non-public address is refused and not contacted', async () => {
    const { t, calls } = transport({ 'example.com': [PUB], 'www.example.com': [PUB], 'intern.example.com': [{ address: '10.0.0.1', family: 4 }] },
      u => u.hostname === 'example.com' ? { status: 302, location: 'https://intern.example.com/' } : { status: 200 });
    const r = await probeChain('https://example.com/', { auditUrl: AUDIT, transport: t, deadline: soon() });
    expect(r.stopped).toBe('refused');
    expect(r.reason).toMatch(/non-public address \(10\.0\.0\.1\)/);
    expect(calls.map(c => c.url)).toEqual(['https://example.com/']);
  });

  it('a redirect to another site is recorded but not fetched; follow: none never follows', async () => {
    const { t, calls } = transport({ 'example.com': [PUB], 'www.example.com': [PUB], 'other.org': [PUB2] },
      () => ({ status: 301, location: 'https://other.org/x' }));
    const r = await probeChain('https://example.com/', { auditUrl: AUDIT, transport: t, deadline: soon() });
    expect(r.stopped).toBe('outside');
    expect(r.outsideUrl).toBe('https://other.org/x');
    expect(calls).toHaveLength(1);
    const { t: t2, calls: c2 } = transport({ 'example.com': [PUB], 'www.example.com': [PUB] }, () => ({ status: 301, location: 'https://www.example.com/' }));
    const r2 = await probeChain('https://example.com/', { auditUrl: AUDIT, transport: t2, deadline: soon(), follow: 'none' });
    expect(r2.stopped).toBe('outside');
    expect(c2).toHaveLength(1);
  });

  it('the audit headers reach the exact audited origin only: not the http variant, not the www twin', async () => {
    const { t, calls } = transport({ 'example.com': [PUB], 'www.example.com': [PUB2] }, u => {
      if (u.protocol === 'http:') return { status: 301, location: 'https://example.com/' };
      if (u.hostname === 'example.com') return { status: 301, location: 'https://www.example.com/' };
      return { status: 200 };
    });
    const r = await probeChain('http://example.com/', { auditUrl: AUDIT, auditHeaders: AUTH, transport: t, deadline: soon() });
    expect(r.steps.map(s => s.url)).toEqual(['http://example.com/', 'https://example.com/', 'https://www.example.com/']);
    expect(calls.map(c => Boolean(c.headers.authorization))).toEqual([false, true, false]);
  });

  it('a resolver that never answers: the probe returns at the deadline and no request starts after it', async () => {
    const { t, calls } = transport({ 'example.com': 'never' }, () => ({ status: 200 }));
    const t0 = Date.now();
    const r = await probeChain('https://example.com/', { auditUrl: AUDIT, transport: t, deadline: t0 + 80 });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.stopped).toBe('deadline');
    expect(calls).toHaveLength(0);
  });

  it('a deadline already past starts nothing', async () => {
    const { t, calls } = transport({ 'example.com': [PUB] }, () => ({ status: 200 }));
    const r = await probeChain('https://example.com/', { auditUrl: AUDIT, transport: t, deadline: Date.now() - 1 });
    expect(r.stopped).toBe('deadline');
    expect(calls).toHaveLength(0);
  });

  it('stops after the most steps it may take', async () => {
    let n = 0;
    const { t } = transport({ 'example.com': [PUB], 'www.example.com': [PUB] }, () => ({ status: 302, location: `https://example.com/${++n}` }));
    const r = await probeChain('https://example.com/', { auditUrl: AUDIT, transport: t, deadline: soon(), maxHops: 3 });
    expect(r.stopped).toBe('max-hops');
    expect(r.steps).toHaveLength(3);
  });
});
