// Number / percentage / position formatters for tabular UI.
//
// Centralised so future external-data tabs (Browserless E1, axe F1,
// Bing G3, DataForSEO G4) reuse the same locale rules instead of each
// reinventing thousands-separator logic.
//
// Locale is fixed to de-DE because the audit UI defaults to German;
// the en-translation flag swaps copy strings, not number formatting,
// to keep audit-to-audit reports visually consistent.

const NUMBER_FORMATTER = new Intl.NumberFormat('de-DE');

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return NUMBER_FORMATTER.format(Math.round(n));
}

// CTR is stored as a 0..1 ratio in GscRow / GscTotals. Render with one
// decimal — matches Search Console UI convention.
export function formatCtr(ratio: number): string {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)} %`;
}

// SERP position with one decimal. Position 1.0 / 2.5 / 11.3 etc.
export function formatPosition(p: number): string {
  if (!Number.isFinite(p)) return '—';
  return p.toFixed(1);
}

// ISO date (YYYY-MM-DD) → de-DE display (DD.MM.YYYY).
// Parsed via regex on the date parts directly, NOT via `new Date(iso)`,
// to avoid the local-timezone shift that would turn "2026-03-31" into
// "30.03.2026" on a negative-UTC-offset machine. Returns the raw input
// when the shape doesn't match — better to surface unexpected values
// than to silently substitute a wrong date.
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
