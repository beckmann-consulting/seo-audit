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
//
// Used directly for `cls` and `score`. For ms-based metrics, prefer
// formatMetricRow() instead so the unit (ms vs s) matches the value.
export function formatComparator(key: MetricKey, locale: 'de' | 'en'): string {
  const t = METRIC_THRESHOLDS[key];
  const good = locale === 'de' ? 'gut' : 'good';
  const poor = locale === 'de' ? 'schlecht' : 'poor';
  if (key === 'score') {
    return `${good}: ≥${formatBound(t.good, key)} · ${poor}: <${formatBound(t.poor, key)} · ${t.source}`;
  }
  return `${good}: <${formatBound(t.good, key)} · ${poor}: >${formatBound(t.poor, key)} · ${t.source}`;
}

// ============================================================
//  Adaptive value+threshold formatting
// ============================================================
// Picks the same unit (ms vs seconds) for both the displayed value and
// the threshold comparator on a single PSI row, so a reader doesn't
// have to mentally convert between units mid-sentence. Rule for
// ms-based metrics: ≥1000ms renders as one-decimal seconds, otherwise
// as integer ms. CLS and score keep their own units.

const MS_TO_SECONDS_THRESHOLD_MS = 1000;
const MS_BASED: MetricKey[] = ['lcp', 'inp', 'fcp', 'ttfb', 'tbt'];

function formatMs(ms: number, unit: 'ms' | 's'): string {
  if (unit === 's') {
    const seconds = Math.round(ms / 100) / 10;
    // Trim trailing ".0" so "4.0s" reads as "4s".
    return `${seconds.toString().replace(/\.0$/, '')}s`;
  }
  return `${Math.round(ms)}ms`;
}

export interface MetricRowFormat {
  display: string;          // value as shown in the value cell
  comparator: string;        // threshold comparator with matching unit
  rating: MetricRating;
}

export function formatMetricRow(rawValue: number, key: MetricKey, locale: 'de' | 'en'): MetricRowFormat {
  const rating = rateMetric(rawValue, key);
  const t = METRIC_THRESHOLDS[key];
  const good = locale === 'de' ? 'gut' : 'good';
  const poor = locale === 'de' ? 'schlecht' : 'poor';

  if (key === 'cls') {
    return {
      display: rawValue.toFixed(3),
      comparator: `${good}: <${t.good.toFixed(2)} · ${poor}: >${t.poor.toFixed(2)} · ${t.source}`,
      rating,
    };
  }

  if (key === 'score') {
    return {
      display: `${rawValue}/100`,
      comparator: `${good}: ≥${t.good}${t.unit} · ${poor}: <${t.poor}${t.unit} · ${t.source}`,
      rating,
    };
  }

  if (MS_BASED.includes(key)) {
    // Pick the unit from the VALUE so the reader sees consistent units
    // within a row. The thresholds are then re-rendered in the same
    // unit even if their natural form would have been the other one.
    const unit: 'ms' | 's' = rawValue >= MS_TO_SECONDS_THRESHOLD_MS ? 's' : 'ms';
    return {
      display: formatMs(rawValue, unit),
      comparator: `${good}: <${formatMs(t.good, unit)} · ${poor}: >${formatMs(t.poor, unit)} · ${t.source}`,
      rating,
    };
  }

  // Fallback (shouldn't be reached for known keys)
  return {
    display: String(rawValue),
    comparator: formatComparator(key, locale),
    rating,
  };
}
