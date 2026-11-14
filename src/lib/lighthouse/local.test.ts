// ultimate-41, point 4: the local Lighthouse measurement with a stand-in runner and clock (no Chromium).
import { describe, it, expect } from 'vitest';
import { measureLighthouse, pickLighthousePages, medianRun, metricsOf, lighthouseFindings, median, type LhrLike, type LighthouseRunner, type Strategy } from './local';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';

function lhr(score: number, fcp: number, tti: number, lcp = 2000): LhrLike {
  return {
    lighthouseVersion: '13.6.0',
    environment: { hostUserAgent: 'Mozilla/5.0 HeadlessChrome/142.0.7444.59 Safari/537.36' },
    categories: { performance: { score: score / 100 } },
    audits: {
      'first-contentful-paint': { numericValue: fcp }, interactive: { numericValue: tti },
      'largest-contentful-paint': { numericValue: lcp }, 'total-blocking-time': { numericValue: 50 },
      'cumulative-layout-shift': { numericValue: 0.01 }, 'speed-index': { numericValue: 1500 },
    },
  };
}

interface Call { url: string; strategy: Strategy; timeoutMs: number; at: number }

function fakeRunner(scores: (url: string, strategy: Strategy, n: number) => number | Error, clock: { t: number }, runMs = 15_000) {
  const calls: Call[] = [];
  let closed = 0;
  const runner: LighthouseRunner = {
    async run(url, strategy, timeoutMs) {
      calls.push({ url, strategy, timeoutMs, at: clock.t });
      const n = calls.filter(c => c.url === url && c.strategy === strategy).length;
      clock.t += runMs;
      const s = scores(url, strategy, n);
      if (s instanceof Error) throw s;
      return lhr(s, 1000 + s, 3000 + s * 10);
    },
    async close() { closed++; },
  };
  return { runner, calls, closedCount: () => closed };
}

describe('local Lighthouse (ultimate-41, point 4)', () => {
  it('pages: the start page and the most internally linked others, ties alphabetical, only 200', () => {
    const pages = [
      seoPage({ url: 'https://example.com/', depth: 0, internalLinks: ['https://example.com/b', 'https://example.com/c'] }),
      seoPage({ url: 'https://example.com/a', depth: 1, internalLinks: ['https://example.com/c'] }),
      seoPage({ url: 'https://example.com/b', depth: 1, internalLinks: [] }),
      seoPage({ url: 'https://example.com/c', depth: 1, internalLinks: ['https://example.com/b'] }),
      seoPage({ url: 'https://example.com/gone', depth: 1, httpStatus: 404 }),
    ];
    expect(pickLighthousePages(pages, 3)).toEqual(['https://example.com/', 'https://example.com/b', 'https://example.com/c']);
    expect(pickLighthousePages(pages, 1)).toEqual(['https://example.com/']);
  });

  it('pages: legal pages are left out although the footer links them everywhere', () => {
    const footer = ['https://example.com/de/datenschutzerklaerung', 'https://example.com/de/impressum'];
    const pages = [
      seoPage({ url: 'https://example.com/de', depth: 0, internalLinks: [...footer, 'https://example.com/de/leistungen'] }),
      seoPage({ url: 'https://example.com/de/datenschutzerklaerung', depth: 1, internalLinks: footer }),
      seoPage({ url: 'https://example.com/de/impressum', depth: 1, internalLinks: footer }),
      seoPage({ url: 'https://example.com/de/leistungen', depth: 1, internalLinks: footer }),
    ];
    expect(pickLighthousePages(pages, 3)).toEqual(['https://example.com/de', 'https://example.com/de/leistungen']);
  });

  it('3 runs per page and strategy, mobile then desktop; the median run chosen by Lighthouse; complete', async () => {
    const clock = { t: 0 };
    const { runner, calls, closedCount } = fakeRunner((_u, s, n) => (s === 'mobile' ? [60, 90, 75][n - 1] : 95), clock);
    const info = await measureLighthouse({ urls: ['https://example.com/', 'https://example.com/b'], runs: 3, deadline: 360_000, runner, now: () => clock.t });
    expect(calls).toHaveLength(12);
    expect(calls.slice(0, 6).map(c => `${c.url} ${c.strategy}`)).toEqual([
      'https://example.com/ mobile', 'https://example.com/ mobile', 'https://example.com/ mobile',
      'https://example.com/ desktop', 'https://example.com/ desktop', 'https://example.com/ desktop',
    ]);
    expect(info.complete).toBe(true);
    expect(info.pairs[0]).toMatchObject({ strategy: 'mobile', runScores: [60, 90, 75], medianScore: 75 });
    expect(info.pairs[0].median?.score).toBe(75); // the run closest to the median FCP and TTI
    expect(info.lighthouseVersion).toBe('13.6.0');
    expect(info.chromiumVersion).toBe('142.0.7444.59');
    expect(closedCount()).toBe(1);
  });

  it('budget: a run starts only when it still fits whole; the result is partial and never passed', async () => {
    const clock = { t: 0 };
    const { runner, calls, closedCount } = fakeRunner(() => 90, clock, 40_000);
    // 100 s: the first run (0 → 40 s) fits, the second needs 60 s from 40 s = 100 s: fits; a third from 80 s does not
    const info = await measureLighthouse({ urls: ['https://example.com/'], runs: 3, deadline: 100_000, runner, now: () => clock.t });
    expect(calls).toHaveLength(2);
    expect(calls.every(c => c.timeoutMs <= 60_000)).toBe(true);
    expect(info.complete).toBe(false);
    expect(info.notes[0]).toMatch(/budget used up before https:\/\/example\.com\/ mobile run 3/);
    expect(closedCount()).toBe(1);
    const f = lighthouseFindings(info);
    expect(f.outcome.status).toBe('not-checkable');
    expect(f.findings).toEqual([]);
    expect(f.homeMobileScore).toBeUndefined();
  });

  it('a budget too small for one run starts no run at all', async () => {
    const clock = { t: 0 };
    const { runner, calls, closedCount } = fakeRunner(() => 90, clock);
    const info = await measureLighthouse({ urls: ['https://example.com/'], runs: 3, deadline: 59_999, runner, now: () => clock.t });
    expect(calls).toHaveLength(0);
    expect(info.pairs.every(p => p.runScores.length === 0)).toBe(true);
    expect(closedCount()).toBe(1);
  });

  it('a failed run is noted; the pair is not complete', async () => {
    const clock = { t: 0 };
    const { runner } = fakeRunner((_u, s, n) => (s === 'mobile' && n === 2 ? new Error('run over its 60000 ms') : 80), clock);
    const info = await measureLighthouse({ urls: ['https://example.com/'], runs: 3, deadline: 1_000_000, runner, now: () => clock.t });
    expect(info.pairs[0].errors).toEqual(['run over its 60000 ms']);
    expect(info.pairs[0].runScores).toEqual([80, 80]);
    expect(info.complete).toBe(false);
  });

  it('findings: start page mobile important under 47, recommended under 72; other pairs recommended or optional; passed at 72 and more', async () => {
    const run = async (score: (u: string, s: Strategy) => number) => {
      const clock = { t: 0 };
      const { runner } = fakeRunner((u, s) => score(u, s), clock);
      return lighthouseFindings(await measureLighthouse({ urls: ['https://example.com/', 'https://example.com/b'], runs: 3, deadline: 1_000_000, runner, now: () => clock.t }));
    };
    const bad = await run((u, s) => (u.endsWith('/') && s === 'mobile' ? 40 : s === 'desktop' ? 60 : 45));
    expect(bad.findings.map(f => [f.code, f.priority])).toEqual([['performance.lighthouse-home', 'important'], ['performance.lighthouse-pages', 'recommended']]);
    expect(bad.findings[0].title_en).toBe('Lighthouse (lab, local) start page on mobile: 40/100');
    expect(bad.outcome.status).toBe('fail');
    expect(bad.homeMobileScore).toBe(40);
    const mid = await run((u, s) => (u.endsWith('/') && s === 'mobile' ? 65 : s === 'desktop' ? 70 : 80));
    expect(mid.findings.map(f => [f.code, f.priority])).toEqual([['performance.lighthouse-home', 'recommended'], ['performance.lighthouse-pages', 'optional']]);
    const good = await run(() => 90);
    expect(good.findings).toEqual([]);
    expect(good.outcome.status).toBe('pass');
    expect(good.homeMobileScore).toBe(90);
  });

  it('median and the fallback without TTI', async () => {
    expect(median([60, 90, 75])).toBe(75);
    expect(median([60, 90])).toBe(75);
    const noTti = [60, 90, 75].map(s => ({ ...lhr(s, 1000, 0), audits: { 'first-contentful-paint': { numericValue: 1000 } } }));
    expect(metricsOf(await medianRun(noTti)).score).toBe(75);
  });
});
