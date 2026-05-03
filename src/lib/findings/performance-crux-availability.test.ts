import { describe, it, expect } from 'vitest';
import { generatePerformanceFindings } from './performance';
import type { PageSpeedData } from '@/types';

// Helper: a PageSpeedData that's "all CrUX available" by default. Each
// test overrides the source flags + values for the metrics it wants to
// mark unavailable.
const allAvailable = (overrides: Partial<PageSpeedData> = {}): PageSpeedData => ({
  performanceScore: 80,
  lcp: 2400, lcpSource: 'field',
  cls: 0.05, clsSource: 'field',
  fcp: 1700, fcpSource: 'field',
  inp: 180, inpSource: 'field',
  ttfb: 540, ttfbSource: 'field',
  tbt: 150,
  ...overrides,
});

describe('CrUX availability finding', () => {
  it('emits no availability finding when all 5 CrUX metrics are present', () => {
    const findings = generatePerformanceFindings(allAvailable());
    expect(findings.find(f => /Real-user performance data/i.test(f.title_en))).toBeUndefined();
  });

  it('emits no availability finding when only 1 CrUX metric is missing', () => {
    const findings = generatePerformanceFindings(allAvailable({
      ttfb: undefined, ttfbSource: 'unavailable',
    }));
    expect(findings.find(f => /Real-user performance data/i.test(f.title_en))).toBeUndefined();
  });

  it('emits the optional availability finding when 2 CrUX metrics are missing', () => {
    const findings = generatePerformanceFindings(allAvailable({
      ttfb: undefined, ttfbSource: 'unavailable',
      inp: undefined, inpSource: 'unavailable',
    }));
    const f = findings.find(x => /Real-user performance data/i.test(x.title_en));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('optional');
    expect(f!.module).toBe('performance');
    expect(f!.description_en).toContain('2 of 5');
  });

  it('emits the availability finding when ALL CrUX metrics are missing', () => {
    const findings = generatePerformanceFindings(allAvailable({
      lcp: undefined, lcpSource: 'unavailable',
      cls: undefined, clsSource: 'unavailable',
      fcp: undefined, fcpSource: 'unavailable',
      inp: undefined, inpSource: 'unavailable',
      ttfb: undefined, ttfbSource: 'unavailable',
    }));
    const f = findings.find(x => /Real-user performance data/i.test(x.title_en));
    expect(f).toBeDefined();
    expect(f!.description_en).toContain('5 of 5');
  });

  it('does NOT emit per-metric LCP findings when LCP is unavailable', () => {
    const findings = generatePerformanceFindings(allAvailable({
      lcp: undefined, lcpSource: 'unavailable',
    }));
    expect(findings.find(f => /Largest Contentful Paint/i.test(f.title_en))).toBeUndefined();
  });

  it('still emits LCP findings when LCP is field-available and over threshold', () => {
    const findings = generatePerformanceFindings(allAvailable({
      lcp: 5000, lcpSource: 'field',
    }));
    expect(findings.find(f => /too slow/i.test(f.title_en))).toBeDefined();
  });
});
