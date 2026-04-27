import { describe, it, expect } from 'vitest';
import { generateMobileDesktopParityFindings } from './seo';

describe('generateMobileDesktopParityFindings', () => {
  it('returns no findings when probe data is undefined (probe disabled)', () => {
    expect(generateMobileDesktopParityFindings(undefined)).toHaveLength(0);
  });

  it('returns no findings on empty probe data', () => {
    expect(generateMobileDesktopParityFindings([])).toHaveLength(0);
  });

  it('returns no findings when all gaps are at or below 20%', () => {
    expect(generateMobileDesktopParityFindings([
      { url: 'https://x.com/a', mobileWords: 100, desktopWords: 100, diffRatio: 0 },
      { url: 'https://x.com/b', mobileWords: 80, desktopWords: 100, diffRatio: 0.2 },
    ])).toHaveLength(0);
  });

  it('flags pages with > 20% gap', () => {
    const findings = generateMobileDesktopParityFindings([
      { url: 'https://x.com/a', mobileWords: 50, desktopWords: 100, diffRatio: 0.5 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('important');
    expect(findings[0].title_en).toContain('1 page');
    expect(findings[0].title_en).toContain('20%');
  });

  it('respects the boundary precisely (0.20 OK, 0.21 fires)', () => {
    expect(generateMobileDesktopParityFindings([
      { url: 'https://x.com/a', mobileWords: 80, desktopWords: 100, diffRatio: 0.20 },
    ])).toHaveLength(0);
    expect(generateMobileDesktopParityFindings([
      { url: 'https://x.com/a', mobileWords: 79, desktopWords: 100, diffRatio: 0.21 },
    ])).toHaveLength(1);
  });

  it('aggregates multiple mismatches, sorted worst-first', () => {
    const findings = generateMobileDesktopParityFindings([
      { url: 'https://x.com/medium', mobileWords: 60, desktopWords: 100, diffRatio: 0.4 },
      { url: 'https://x.com/worst', mobileWords: 10, desktopWords: 100, diffRatio: 0.9 },
      { url: 'https://x.com/ok', mobileWords: 95, desktopWords: 100, diffRatio: 0.05 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('2 page');
    const desc = findings[0].description_en;
    const worstIdx = desc.indexOf('https://x.com/worst');
    const mediumIdx = desc.indexOf('https://x.com/medium');
    expect(worstIdx).toBeLessThan(mediumIdx); // sorted desc
    expect(desc).not.toContain('https://x.com/ok');
  });

  it('includes the per-page mobile/desktop counts and Δ% in the description', () => {
    const findings = generateMobileDesktopParityFindings([
      { url: 'https://x.com/a', mobileWords: 30, desktopWords: 90, diffRatio: 0.667 },
    ]);
    expect(findings[0].description_en).toContain('mobile 30');
    expect(findings[0].description_en).toContain('desktop 90');
    expect(findings[0].description_en).toContain('67%');
  });

  it('caps the sample at 5', () => {
    const probes = Array.from({ length: 12 }, (_, i) => ({
      url: `https://x.com/${i}`,
      mobileWords: 30,
      desktopWords: 100,
      diffRatio: 0.7,
    }));
    const findings = generateMobileDesktopParityFindings(probes);
    expect(findings).toHaveLength(1);
    const examples = findings[0].description_en.match(/https:\/\/x\.com\/\d/g) || [];
    expect(examples.length).toBe(5);
  });
});
