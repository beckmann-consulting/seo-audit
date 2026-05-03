import { describe, expect, it } from 'vitest';
import { rateMetric, formatComparator, METRIC_THRESHOLDS } from './metric-thresholds';

describe('rateMetric — lower-is-better metrics', () => {
  it('rates LCP at boundary as good (≤ good)', () => {
    expect(rateMetric(2500, 'lcp')).toBe('good');
    expect(rateMetric(2499, 'lcp')).toBe('good');
  });
  it('rates LCP just over good as needs-improvement', () => {
    expect(rateMetric(2501, 'lcp')).toBe('needs-improvement');
    expect(rateMetric(4000, 'lcp')).toBe('needs-improvement');
  });
  it('rates LCP over poor bound as poor', () => {
    expect(rateMetric(4001, 'lcp')).toBe('poor');
    expect(rateMetric(99999, 'lcp')).toBe('poor');
  });
  it('rates CLS using the fractional thresholds', () => {
    expect(rateMetric(0.05, 'cls')).toBe('good');
    expect(rateMetric(0.10, 'cls')).toBe('good');
    expect(rateMetric(0.15, 'cls')).toBe('needs-improvement');
    expect(rateMetric(0.30, 'cls')).toBe('poor');
  });
});

describe('rateMetric — higher-is-better (score)', () => {
  it('rates ≥90 as good', () => {
    expect(rateMetric(90, 'score')).toBe('good');
    expect(rateMetric(100, 'score')).toBe('good');
  });
  it('rates 50–89 as needs-improvement', () => {
    expect(rateMetric(89, 'score')).toBe('needs-improvement');
    expect(rateMetric(50, 'score')).toBe('needs-improvement');
  });
  it('rates <50 as poor', () => {
    expect(rateMetric(49, 'score')).toBe('poor');
    expect(rateMetric(0, 'score')).toBe('poor');
  });
});

describe('formatComparator', () => {
  it('returns DE labels with web.dev source for LCP', () => {
    expect(formatComparator('lcp', 'de')).toBe('gut: <2500ms · schlecht: >4000ms · web.dev');
  });
  it('returns EN labels with web.dev source for LCP', () => {
    expect(formatComparator('lcp', 'en')).toBe('good: <2500ms · poor: >4000ms · web.dev');
  });
  it('inverts the comparison for score (higher is better)', () => {
    expect(formatComparator('score', 'en')).toBe('good: ≥90/100 · poor: <50/100 · Lighthouse');
  });
  it('formats CLS with two decimals and no unit', () => {
    expect(formatComparator('cls', 'en')).toBe('good: <0.10 · poor: >0.25 · web.dev');
  });
  it('attributes TBT to Lighthouse, not web.dev', () => {
    expect(formatComparator('tbt', 'en')).toContain('Lighthouse');
  });
});

describe('METRIC_THRESHOLDS — sanity', () => {
  it('keeps the canonical good/poor numerics', () => {
    expect(METRIC_THRESHOLDS.lcp.good).toBe(2500);
    expect(METRIC_THRESHOLDS.lcp.poor).toBe(4000);
    expect(METRIC_THRESHOLDS.inp.good).toBe(200);
    expect(METRIC_THRESHOLDS.cls.poor).toBe(0.25);
    expect(METRIC_THRESHOLDS.score.good).toBe(90);
  });
});
