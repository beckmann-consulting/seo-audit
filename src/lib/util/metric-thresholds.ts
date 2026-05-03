// PSI / Core Web Vitals reference thresholds — single source of truth.
//
// Values match the canonical sources as of Q2 2026:
//   LCP, INP, CLS, FCP, TTFB → web.dev MetricRatingThresholds (also
//      exported by the web-vitals npm package as LCPThresholds /
//      INPThresholds / CLSThresholds / FCPThresholds / TTFBThresholds).
//   TBT, score                → Lighthouse scoring documentation.
//
// Convention: `good` is the upper bound for the "good" bucket and `poor`
// is the lower bound for the "poor" bucket. Values strictly between are
// "needs-improvement". The `score` key is the only one where higher is
// better (inverted comparison handled in rateMetric below).
//
// Hard-coded rather than imported from `web-vitals` because the package
// pulls in a runtime + browser-API dependency we don't otherwise need.
// Re-verify these values when reviewing a Lighthouse / web-vitals upgrade.

export type MetricRating = 'good' | 'needs-improvement' | 'poor';
export type MetricKey = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb' | 'tbt' | 'score';

interface Threshold {
  good: number;
  poor: number;
  unit: string;
  source: 'web.dev' | 'Lighthouse';
}

export const METRIC_THRESHOLDS: Record<MetricKey, Threshold> = {
  lcp:   { good: 2500, poor: 4000, unit: 'ms',   source: 'web.dev' },
  inp:   { good: 200,  poor: 500,  unit: 'ms',   source: 'web.dev' },
  cls:   { good: 0.1,  poor: 0.25, unit: '',     source: 'web.dev' },
  fcp:   { good: 1800, poor: 3000, unit: 'ms',   source: 'web.dev' },
  ttfb:  { good: 800,  poor: 1800, unit: 'ms',   source: 'web.dev' },
  tbt:   { good: 200,  poor: 600,  unit: 'ms',   source: 'Lighthouse' },
  score: { good: 90,   poor: 50,   unit: '/100', source: 'Lighthouse' },
};

export function rateMetric(value: number, key: MetricKey): MetricRating {
  const t = METRIC_THRESHOLDS[key];
  if (key === 'score') {
    // Higher is better: ≥ good → good, < poor → poor, else needs-improvement.
    if (value >= t.good) return 'good';
    if (value < t.poor) return 'poor';
    return 'needs-improvement';
  }
  // Lower is better: ≤ good → good, > poor → poor, else needs-improvement.
  if (value <= t.good) return 'good';
  if (value > t.poor) return 'poor';
  return 'needs-improvement';
}

function formatBound(n: number, key: MetricKey): string {
  const t = METRIC_THRESHOLDS[key];
  if (key === 'cls') return n.toFixed(2);
  return `${n}${t.unit}`;
}

// Returns the muted suffix line shown beneath each PSI metric, e.g.:
//   "good: <2500ms · poor: >4000ms · web.dev"
//   "gut: <2500ms · schlecht: >4000ms · web.dev"
//   "good: ≥90/100 · poor: <50/100 · Lighthouse"   (score, inverted)
export function formatComparator(key: MetricKey, locale: 'de' | 'en'): string {
  const t = METRIC_THRESHOLDS[key];
  const good = locale === 'de' ? 'gut' : 'good';
  const poor = locale === 'de' ? 'schlecht' : 'poor';
  if (key === 'score') {
    return `${good}: ≥${formatBound(t.good, key)} · ${poor}: <${formatBound(t.poor, key)} · ${t.source}`;
  }
  return `${good}: <${formatBound(t.good, key)} · ${poor}: >${formatBound(t.poor, key)} · ${t.source}`;
}
