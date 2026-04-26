import { describe, it, expect } from 'vitest';
import {
  measurePixelWidth,
  TITLE_LIMIT_MOBILE_PX,
  TITLE_LIMIT_DESKTOP_PX,
  META_DESC_LIMIT_PX,
} from './pixel-width';

// Helper: assert measured value is within ±5% of expected.
function expectWithin5Percent(actual: number, expected: number) {
  const tolerance = expected * 0.05;
  expect(actual).toBeGreaterThanOrEqual(Math.round(expected - tolerance));
  expect(actual).toBeLessThanOrEqual(Math.round(expected + tolerance));
}

describe('measurePixelWidth', () => {
  it('returns 0 for empty / undefined-ish input', () => {
    expect(measurePixelWidth('')).toBe(0);
  });

  it('skips line breaks (no width contribution)', () => {
    expect(measurePixelWidth('\n')).toBe(0);
    expect(measurePixelWidth('\r\n')).toBe(0);
    // Newline shouldn't affect surrounding chars
    const a = measurePixelWidth('Hello');
    const b = measurePixelWidth('Hello\n');
    expect(a).toBe(b);
  });

  it('produces narrow widths for narrow letters', () => {
    // 'iiii' = 4 × 4.4 ≈ 18px
    expectWithin5Percent(measurePixelWidth('iiii'), 18);
  });

  it('produces wide widths for wide letters', () => {
    // 'WWWW' = 4 × 18.9 ≈ 76px
    expectWithin5Percent(measurePixelWidth('WWWW'), 76);
  });

  it('treats CJK as full-width (~20px each)', () => {
    expectWithin5Percent(measurePixelWidth('你好'), 40);
    expectWithin5Percent(measurePixelWidth('日本語'), 60);
  });

  it('treats Latin diacritics with the ~11px fallback', () => {
    // 'über' — ü(11) + b(11.1) + e(11.1) + r(6.7) ≈ 40px
    expectWithin5Percent(measurePixelWidth('über'), 40);
    // German "Größe" — G(15.6) + r(6.7) + ö(11) + ß(11) + e(11.1) ≈ 55px
    expectWithin5Percent(measurePixelWidth('Größe'), 55);
  });

  it('captures the W-vs-i asymmetry that motivated the metric', () => {
    // 60 i's vs 60 W's: massive width difference for same char count
    const iWidth = measurePixelWidth('i'.repeat(60));
    const wWidth = measurePixelWidth('W'.repeat(60));
    expect(wWidth).toBeGreaterThan(iWidth * 4);
  });

  it('matches a known SERP example (Google\'s mobile cut at 580px is ~60-65 normal chars)', () => {
    // A typical 60-char title with mixed casing should land roughly around the limit.
    const title = 'How to bake the perfect sourdough loaf at home in one day';
    const px = measurePixelWidth(title);
    // Expected around ~480-540px depending on letter mix; test that it's
    // in a sensible range for a 58-char title and well under the limit.
    expect(px).toBeGreaterThan(400);
    expect(px).toBeLessThan(600);
  });

  it('exposes the documented threshold constants', () => {
    expect(TITLE_LIMIT_MOBILE_PX).toBe(580);
    expect(TITLE_LIMIT_DESKTOP_PX).toBe(600);
    expect(META_DESC_LIMIT_PX).toBe(990);
  });
});
