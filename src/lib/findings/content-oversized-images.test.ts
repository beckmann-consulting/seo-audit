import { describe, it, expect } from 'vitest';
import { generateOversizedImageFindings } from './content';

describe('generateOversizedImageFindings', () => {
  it('returns no findings when imageSizes is undefined (probe disabled)', () => {
    expect(generateOversizedImageFindings(undefined)).toHaveLength(0);
  });

  it('returns no findings on empty input', () => {
    expect(generateOversizedImageFindings([])).toHaveLength(0);
  });

  it('returns no findings when all images are under 200KB', () => {
    expect(generateOversizedImageFindings([
      { url: 'https://x.com/a.jpg', sizeBytes: 50_000 },
      { url: 'https://x.com/b.jpg', sizeBytes: 199_000 },
    ])).toHaveLength(0);
  });

  it('flags images strictly larger than 200KB (boundary)', () => {
    // 200*1024 = 204800 bytes — strictly greater than that triggers
    expect(generateOversizedImageFindings([
      { url: 'https://x.com/a.jpg', sizeBytes: 204_800 },
    ])).toHaveLength(0);
    expect(generateOversizedImageFindings([
      { url: 'https://x.com/a.jpg', sizeBytes: 204_801 },
    ])).toHaveLength(1);
  });

  it('lists worst offenders first (sorted desc)', () => {
    const findings = generateOversizedImageFindings([
      { url: 'https://x.com/medium.jpg', sizeBytes: 300_000 },
      { url: 'https://x.com/big.jpg', sizeBytes: 800_000 },
      { url: 'https://x.com/small-fail.jpg', sizeBytes: 250_000 },
    ]);
    expect(findings).toHaveLength(1);
    const desc = findings[0].description_en;
    // The first sample URL should be the largest
    const firstBigIdx = desc.indexOf('big.jpg');
    const firstMediumIdx = desc.indexOf('medium.jpg');
    expect(firstBigIdx).toBeGreaterThan(0);
    expect(firstBigIdx).toBeLessThan(firstMediumIdx);
  });

  it('caps the sample at 5 entries', () => {
    const sizes = Array.from({ length: 12 }, (_, i) => ({
      url: `https://x.com/img-${i}.jpg`,
      sizeBytes: 300_000 + i * 1000,
    }));
    const findings = generateOversizedImageFindings(sizes);
    expect(findings).toHaveLength(1);
    const examples = findings[0].description_en.match(/https:\/\/x\.com\/img-\d+\.jpg/g) || [];
    expect(examples.length).toBe(5);
  });

  it('renders KB sizes in the description', () => {
    const findings = generateOversizedImageFindings([
      { url: 'https://x.com/hero.jpg', sizeBytes: 512_000 }, // 500 KB
    ]);
    expect(findings[0].description_en).toMatch(/500 KB/);
  });

  it('mentions the 200KB threshold in the title (machine-readable)', () => {
    const findings = generateOversizedImageFindings([
      { url: 'https://x.com/hero.jpg', sizeBytes: 300_000 },
    ]);
    expect(findings[0].title_en).toContain('200');
  });

  it('uses Recommended severity (not Important — many sites have legit big heroes)', () => {
    const findings = generateOversizedImageFindings([
      { url: 'https://x.com/hero.jpg', sizeBytes: 5_000_000 },
    ]);
    expect(findings[0].priority).toBe('recommended');
  });
});
