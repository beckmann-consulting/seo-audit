import { describe, expect, it } from 'vitest';
import { rateMetric, formatComparator, formatMetricRow, METRIC_THRESHOLDS } from './metric-thresholds';

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

describe('formatMetricRow — unit consistency between value and threshold', () => {
  it('renders LCP value AND thresholds in seconds when value >= 1000ms', () => {
    const f = formatMetricRow(20300, 'lcp', 'en');
    expect(f.display).toBe('20.3s');
    expect(f.comparator).toBe('good: <2.5s · poor: >4s · web.dev');
    expect(f.rating).toBe('poor');
  });
  it('renders TTFB value AND thresholds in ms when value < 1000ms', () => {
    const f = formatMetricRow(540, 'ttfb', 'en');
    expect(f.display).toBe('540ms');
    expect(f.comparator).toBe('good: <800ms · poor: >1800ms · web.dev');
    expect(f.rating).toBe('good');
  });
  it('boundary: 999ms stays in ms, 1000ms switches to seconds', () => {
    expect(formatMetricRow(999, 'fcp', 'en').display).toBe('999ms');
    expect(formatMetricRow(999, 'fcp', 'en').comparator).toContain('ms');
    expect(formatMetricRow(1000, 'fcp', 'en').display).toBe('1s');
    expect(formatMetricRow(1000, 'fcp', 'en').comparator).toContain('s ');
  });
  it('CLS unaffected by ms rule (unitless, three decimals)', () => {
    const f = formatMetricRow(0.021, 'cls', 'en');
    expect(f.display).toBe('0.021');
    expect(f.comparator).toBe('good: <0.10 · poor: >0.25 · web.dev');
  });
  it('score uses /100 in both display and comparator', () => {
    const f = formatMetricRow(61, 'score', 'en');
    expect(f.display).toBe('61/100');
    expect(f.comparator).toBe('good: ≥90/100 · poor: <50/100 · Lighthouse');
  });
  it('localises to DE labels', () => {
    expect(formatMetricRow(20300, 'lcp', 'de').comparator).toBe('gut: <2.5s · schlecht: >4s · web.dev');
  });
  it('TBT inherits the same rule (Lighthouse source)', () => {
    expect(formatMetricRow(180, 'tbt', 'en').comparator).toBe('good: <200ms · poor: >600ms · Lighthouse');
    expect(formatMetricRow(2400, 'tbt', 'en').comparator).toBe('good: <0.2s · poor: >0.6s · Lighthouse');
  });
});
