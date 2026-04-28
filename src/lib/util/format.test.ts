import { describe, it, expect } from 'vitest';
import { formatNumber, formatCtr, formatPosition, formatDate } from './format';

describe('formatNumber', () => {
  it('inserts thousands separator (de-DE: dot)', () => {
    expect(formatNumber(1000)).toBe('1.000');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('rounds non-integers to nearest', () => {
    expect(formatNumber(1234.5)).toBe('1.235');
    expect(formatNumber(0.4)).toBe('0');
  });

  it('returns dash for non-finite input', () => {
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(Infinity)).toBe('—');
  });

  it('handles zero and small values', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(7)).toBe('7');
  });
});

describe('formatCtr', () => {
  it('renders ratio as percent with one decimal and space-suffix', () => {
    expect(formatCtr(0.0234)).toBe('2.3 %');
    expect(formatCtr(0.5)).toBe('50.0 %');
    expect(formatCtr(0)).toBe('0.0 %');
  });

  it('returns dash for non-finite input', () => {
    expect(formatCtr(NaN)).toBe('—');
  });
});

describe('formatPosition', () => {
  it('renders one decimal', () => {
    expect(formatPosition(1)).toBe('1.0');
    expect(formatPosition(11.34)).toBe('11.3');
    expect(formatPosition(2.55)).toMatch(/^2\.[56]$/); // toFixed banker rounding edge-case
  });

  it('returns dash for non-finite input', () => {
    expect(formatPosition(NaN)).toBe('—');
  });
});

describe('formatDate', () => {
  it('reformats YYYY-MM-DD to DD.MM.YYYY', () => {
    expect(formatDate('2026-03-31')).toBe('31.03.2026');
    expect(formatDate('2026-04-25')).toBe('25.04.2026');
  });

  it('accepts a fuller ISO timestamp and uses just the date part', () => {
    expect(formatDate('2026-04-25T12:34:56Z')).toBe('25.04.2026');
  });

  it('does NOT shift dates by local timezone (would break "2026-03-31" on negative UTC offsets)', () => {
    // Regression guard for the tz-shift bug avoided by parsing the
    // string directly instead of via `new Date(iso).toLocaleDateString`.
    expect(formatDate('2026-03-31')).toBe('31.03.2026');
    expect(formatDate('2026-01-01')).toBe('01.01.2026');
  });

  it('returns input unchanged for malformed values', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
    expect(formatDate('')).toBe('');
  });
});
