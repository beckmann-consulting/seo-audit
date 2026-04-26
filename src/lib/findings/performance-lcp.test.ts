import { describe, it, expect } from 'vitest';
import { generatePerformanceFindings } from './performance';
import type { PageSpeedData } from '@/types';

const baseSpeed = (overrides: Partial<PageSpeedData>): PageSpeedData => ({
  performanceScore: 80,
  ...overrides,
});

describe('LCP findings — element surfacing', () => {
  it('produces no LCP finding when LCP is fast', () => {
    const findings = generatePerformanceFindings(baseSpeed({ lcp: 1200 }));
    const lcp = findings.filter(f => /Largest Contentful Paint/i.test(f.title_en));
    expect(lcp).toHaveLength(0);
  });

  it('emits Important finding for LCP > 4s', () => {
    const findings = generatePerformanceFindings(baseSpeed({ lcp: 5200 }));
    const lcp = findings.find(f => f.title_en.includes('too slow'));
    expect(lcp).toBeDefined();
    expect(lcp!.priority).toBe('important');
    expect(lcp!.title_en).toContain('5.2s');
  });

  it('emits Recommended finding for LCP between 2.5s and 4s', () => {
    const findings = generatePerformanceFindings(baseSpeed({ lcp: 3200 }));
    const lcp = findings.find(f => f.title_en.includes('needs improvement'));
    expect(lcp).toBeDefined();
    expect(lcp!.priority).toBe('recommended');
    expect(lcp!.title_en).toContain('3.2s');
  });

  it('appends LCP element selector + snippet to the finding when available', () => {
    const findings = generatePerformanceFindings(baseSpeed({
      lcp: 5500,
      lcpElement: {
        selector: 'main > img.hero',
        snippet: '<img src="hero.jpg" alt="Hero">',
      },
    }));
    const lcp = findings.find(f => f.title_en.includes('too slow'))!;
    expect(lcp.description_en).toContain('main > img.hero');
    expect(lcp.description_en).toContain('<img src="hero.jpg" alt="Hero">');
  });

  it('omits element context cleanly when Lighthouse did not return one', () => {
    const findings = generatePerformanceFindings(baseSpeed({ lcp: 5500 }));
    const lcp = findings.find(f => f.title_en.includes('too slow'))!;
    // Description should NOT contain "LCP element:" sentinel
    expect(lcp.description_en).not.toContain('LCP element:');
    expect(lcp.description_de).not.toContain('LCP-Element:');
  });

  it('adds image-specific hints when LCP is a lazy-loaded <img>', () => {
    const findings = generatePerformanceFindings(baseSpeed({
      lcp: 5500,
      lcpElement: {
        selector: 'img.hero',
        snippet: '<img src="hero.jpg" loading="lazy">',
      },
    }));
    const lcp = findings.find(f => f.title_en.includes('too slow'))!;
    expect(lcp.recommendation_en).toMatch(/loading="lazy"/);
    expect(lcp.recommendation_en).toMatch(/fetchpriority/);
    expect(lcp.recommendation_en).toMatch(/width\/height/);
  });

  it('does NOT add image hints when LCP element is a heading or text', () => {
    const findings = generatePerformanceFindings(baseSpeed({
      lcp: 5500,
      lcpElement: {
        selector: 'h1.headline',
        snippet: '<h1 class="headline">Welcome</h1>',
      },
    }));
    const lcp = findings.find(f => f.title_en.includes('too slow'))!;
    // Element selector is shown
    expect(lcp.description_en).toContain('h1.headline');
    // ...but no img-specific hints in the recommendation
    expect(lcp.recommendation_en).not.toMatch(/loading="lazy"/);
    expect(lcp.recommendation_en).not.toMatch(/fetchpriority/);
  });

  it('truncates very long snippets to keep the finding readable', () => {
    const longSnippet = '<img src="hero.jpg" data-junk="' + 'x'.repeat(500) + '">';
    const findings = generatePerformanceFindings(baseSpeed({
      lcp: 5500,
      lcpElement: {
        selector: 'img.hero',
        snippet: longSnippet,
      },
    }));
    const lcp = findings.find(f => f.title_en.includes('too slow'))!;
    // Description should contain ellipsis and not blow past the cap
    expect(lcp.description_en).toContain('…');
    // Captured snippet length in description shouldn't exceed ~210 chars
    const snippetMatch = lcp.description_en.match(/<img[^]*?…/);
    expect(snippetMatch).toBeTruthy();
    expect(snippetMatch![0].length).toBeLessThanOrEqual(210);
  });

  it('also surfaces the element on the Recommended LCP finding (2.5-4s)', () => {
    const findings = generatePerformanceFindings(baseSpeed({
      lcp: 3200,
      lcpElement: {
        selector: 'img.hero',
        snippet: '<img src="hero.jpg" loading="lazy">',
      },
    }));
    const lcp = findings.find(f => f.title_en.includes('needs improvement'))!;
    expect(lcp.description_en).toContain('img.hero');
    expect(lcp.recommendation_en).toMatch(/loading="lazy"/);
  });
});
