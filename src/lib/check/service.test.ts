import { describe, expect, it } from 'vitest';
import { CACHE_TTL_MS, checkCorsHeaders, clientAddressFrom, createCheckService } from './service';
import { FakeNet } from './fake-net';
import type { CheckMeasurement, CheckOutcome, RunOptions } from './run-check';

const HOUR = 60 * 60 * 1000;
const RESULT: CheckMeasurement = {
  host: 'praxis.example', score: 80, modules: [{ module: 'legal', score: 90 }],
  findings: [{ de: { title: 'Titel', text: 'Text' }, en: { title: 'Title', text: 'Text' } }],
  pages: 1, performanceMeasured: true, checkedAt: '2026-11-07T00:00:00.000Z',
};
const okRunner = async (): Promise<CheckOutcome> => ({ ok: true, result: RESULT });

describe('check service: cache', () => {
  it('serves a cached result without a run or a limit, and deletes it after 24 hours', async () => {
    let t = Date.UTC(2026, 10, 7, 12);
    let runs = 0;
    const s = createCheckService({ now: () => t, perHour: 1, runner: async () => { runs++; return okRunner(); }, log: () => {} });
    expect((await s.handle({ domain: 'praxis.example', lang: 'de', clientAddress: '203.0.113.5' })).status).toBe(200);
    const again = await s.handle({ domain: 'https://PRAXIS.example/', lang: 'de', clientAddress: '203.0.113.5' });
    expect(again).toMatchObject({ status: 200, body: { cached: true } });
    expect(runs).toBe(1);
    t += CACHE_TTL_MS;
    s.sweep();
    expect(s.state().cached).toBe(0);
  });
});

describe('check service: one run per host for both languages (Prüfer-224)', () => {
  it('answers German and English from one run, so PageSpeed runs once per host', async () => {
    let runs = 0;
    const s = createCheckService({ runner: async () => { runs++; return okRunner(); }, log: () => {} });
    const de = await s.handle({ domain: 'praxis.example', lang: 'de', clientAddress: '203.0.113.5' });
    const en = await s.handle({ domain: 'praxis.example', lang: 'en', clientAddress: '203.0.113.6' });
    expect(runs).toBe(1);
    expect(de).toMatchObject({ status: 200, body: { cached: false, result: { modules: [{ label: 'Rechtliche Basisangaben' }], findings: [{ title: 'Titel' }] } } });
    expect(en).toMatchObject({ status: 200, body: { cached: true, result: { modules: [{ label: 'Basic legal information' }], findings: [{ title: 'Title' }] } } });
  });
});

describe('check service: limits', () => {
  it('allows 3 new runs per /24 and hour, and forgets the address after an hour', async () => {
    let t = Date.UTC(2026, 10, 7, 12);
    const s = createCheckService({ now: () => t, runner: okRunner, log: () => {} });
    const statuses = [];
    for (const d of ['a.example', 'b.example', 'c.example', 'd.example']) {
      statuses.push((await s.handle({ domain: d, lang: 'de', clientAddress: `203.0.113.${statuses.length + 1}` })).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
    t += HOUR;
    s.sweep();
    expect(s.state().addresses).toBe(0);
    expect((await s.handle({ domain: 'e.example', lang: 'de', clientAddress: '203.0.113.9' })).status).toBe(200);
  });

  it('stops at the daily cap and when both slots are busy', async () => {
    const t = Date.UTC(2026, 10, 7, 12);
    const capped = createCheckService({ now: () => t, perDay: 1, perHour: 10, runner: okRunner, log: () => {} });
    await capped.handle({ domain: 'a.example', lang: 'de', clientAddress: '1.2.3.4' });
    expect(await capped.handle({ domain: 'b.example', lang: 'de', clientAddress: '1.2.3.4' })).toMatchObject({ status: 503, body: { error: 'daily_limit' } });

    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const busy = createCheckService({ concurrent: 1, perHour: 10, runner: async () => { await gate; return okRunner(); }, log: () => {} });
    const first = busy.handle({ domain: 'a.example', lang: 'de', clientAddress: '1.2.3.4' });
    expect(await busy.handle({ domain: 'b.example', lang: 'de', clientAddress: '5.6.7.8' })).toMatchObject({ status: 503, body: { error: 'busy' } });
    release();
    await first;
    expect(busy.state().slotsInUse).toBe(0);
  });

  it('refuses invalid input without a run', async () => {
    let runs = 0;
    const s = createCheckService({ runner: async () => { runs++; return okRunner(); }, log: () => {} });
    for (const d of [undefined, 42, '127.0.0.1', 'localhost', 'a b.example']) {
      expect((await s.handle({ domain: d, lang: 'de', clientAddress: '1.2.3.4' })).status).toBe(400);
    }
    expect(runs).toBe(0);
  });
});

describe('check service: deadline', () => {
  it('aborts a hanging run, answers 504 and frees the slot only after the work has ended', async () => {
    const net = new FakeNet({ 'slow.example': ['93.184.216.34'] }, () => ({ status: 200, hang: true }));
    let slotsWhileRunning = -1;
    const s = createCheckService({
      deadlineMs: 300, perHour: 10, log: () => {},
      transportFor: signal => net.transport(signal),
      runner: async (host: string, o: RunOptions) => {
        const { runCheck } = await import('./run-check');
        const r = await runCheck(host, o);
        slotsWhileRunning = s.state().slotsInUse;
        return r;
      },
    });
    const r = await s.handle({ domain: 'slow.example', lang: 'en', clientAddress: '1.2.3.4' });
    expect(r).toMatchObject({ status: 504, body: { error: 'timeout' } });
    expect(slotsWhileRunning).toBe(1);
    expect(net.open).toBe(0);
    expect(s.state().slotsInUse).toBe(0);
  });
});

describe('check service: log', () => {
  it('writes neither the domain nor the address', async () => {
    const lines: string[] = [];
    const s = createCheckService({ runner: okRunner, log: l => lines.push(l) });
    await s.handle({ domain: 'geheim-praxis.example', lang: 'de', clientAddress: '203.0.113.77' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/geheim|203\.0\.113/);
    expect(lines[0]).toMatch(/host=[0-9a-f]{12} ms=\d+ outcome=ok/);
  });
});

describe('client address and CORS', () => {
  it('takes the last X-Forwarded-For entry, the one Caddy set', () => {
    const h = (v: string | null) => ({ get: (n: string) => (n === 'x-forwarded-for' ? v : null) });
    expect(clientAddressFrom(h('6.6.6.6, 203.0.113.5'))).toBe('203.0.113.5');
    expect(clientAddressFrom(h(null))).toBe('unknown');
  });

  it('allows beckmanndigital.com only in production', () => {
    expect(checkCorsHeaders('https://beckmanndigital.com', false)['Access-Control-Allow-Origin']).toBe('https://beckmanndigital.com');
    expect(checkCorsHeaders('https://evil.example', false)['Access-Control-Allow-Origin']).toBe('https://beckmanndigital.com');
    expect(checkCorsHeaders('http://localhost:3000', false)['Access-Control-Allow-Origin']).toBe('https://beckmanndigital.com');
    expect(checkCorsHeaders('http://localhost:3000', true)['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });
});
