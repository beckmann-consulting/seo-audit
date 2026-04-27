import { describe, it, expect } from 'vitest';
import { generateAccessibilityFindings } from './accessibility';
import type { AxeViolation, PageSEOData } from '@/types';

function pageAt(url: string, axeViolations?: AxeViolation[]): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: 0, hasCanonical: true,
    renderBlockingScripts: 0, modernImageFormats: 0, lazyLoadedImages: 0,
    hreflangs: [],
    viewportBlocksZoom: false, viewportHasInitialScale: true,
    fixedWidthElements: 0, smallFontElements: 0, legacyPlugins: 0,
    likelyClientRendered: false,
    genericAnchors: [], emptyAnchors: 0, hasNoindex: false,
    imageDetails: [], fontPreloads: 0, hasFontDisplaySwap: false, hasExternalFonts: false,
    thirdPartyScripts: [],
    hasFavicon: true, hasAppleTouchIcon: true, hasWebManifest: true, hasThemeColor: true,
    httpStatus: 200, protocol: null,
    headingStructure: [], hasPaginationLinks: false, paginationUrls: [],
    hasAuthorSignal: true, hasDateSignal: true, externalLinksDetailed: [],
    xRobotsNoindex: false, xRobotsBotSpecific: [],
    hasJsonLd: false, hasMicrodata: false, hasRdfa: false,
    bodyTextHash: '', bodyMinhash: [], textHtmlRatio: 0.2, smallTouchTargetCount: 0,
    axeViolations,
  };
}

function violation(o: Partial<AxeViolation> & { id: string; impact: AxeViolation['impact'] }): AxeViolation {
  return {
    id: o.id,
    impact: o.impact,
    description: o.description ?? `${o.id} description`,
    help: o.help ?? `Help for ${o.id}`,
    helpUrl: o.helpUrl ?? `https://dequeuniversity.com/rules/axe/4.x/${o.id}`,
    tags: o.tags ?? ['wcag2aa', 'wcag143'],
    nodes: o.nodes ?? 1,
  };
}

describe('generateAccessibilityFindings — module gating', () => {
  it('returns nothing when the module was not selected', () => {
    expect(generateAccessibilityFindings([
      pageAt('https://x.com/', [violation({ id: 'color-contrast', impact: 'serious' })]),
    ], false)).toHaveLength(0);
  });

  it('returns the JS-mode-required guidance finding when module is on but no page has axe data', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/'),
      pageAt('https://x.com/about'),
    ], true);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('JS mode required');
    expect(findings[0].priority).toBe('optional');
  });

  it('returns nothing when module is on and axe ran on at least one page but found nothing', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/', []), // ran but empty
    ], true);
    expect(findings).toHaveLength(0);
  });
});

describe('generateAccessibilityFindings — clustering', () => {
  it('clusters one finding per axe rule across pages', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/a', [violation({ id: 'color-contrast', impact: 'serious', nodes: 5 })]),
      pageAt('https://x.com/b', [violation({ id: 'color-contrast', impact: 'serious', nodes: 12 })]),
      pageAt('https://x.com/c', [violation({ id: 'color-contrast', impact: 'serious', nodes: 1 })]),
    ], true);
    // Expected: 1 finding for color-contrast covering 3 pages, 18 nodes total.
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('18 element');
    expect(findings[0].title_en).toContain('3 page');
  });

  it('emits separate findings for distinct rule ids', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/a', [
        violation({ id: 'color-contrast', impact: 'serious' }),
        violation({ id: 'image-alt', impact: 'critical' }),
      ]),
    ], true);
    expect(findings).toHaveLength(2);
    const ids = findings.map(f => f.title_en).sort();
    expect(ids[0]).toContain('Help for');
  });

  it('caps the URL sample at 5 in the description', () => {
    const pages = Array.from({ length: 12 }, (_, i) =>
      pageAt(`https://x.com/${i}`, [violation({ id: 'color-contrast', impact: 'serious' })]),
    );
    const findings = generateAccessibilityFindings(pages, true);
    expect(findings).toHaveLength(1);
    const examples = findings[0].description_en.match(/https:\/\/x\.com\/\d+/g) || [];
    expect(examples.length).toBe(5);
    expect(findings[0].description_en).toContain('+7'); // 12 - 5 in the suffix
  });
});

describe('generateAccessibilityFindings — severity mapping', () => {
  const cases: Array<[AxeViolation['impact'], string]> = [
    ['critical', 'critical'],
    ['serious', 'important'],
    ['moderate', 'recommended'],
    ['minor', 'optional'],
  ];

  for (const [impact, priority] of cases) {
    it(`maps axe ${impact} to ${priority}`, () => {
      const findings = generateAccessibilityFindings([
        pageAt('https://x.com/', [violation({ id: `r-${impact}`, impact })]),
      ], true);
      expect(findings[0].priority).toBe(priority);
    });
  }

  it('falls back to "recommended" when impact is null', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/', [violation({ id: 'unknown', impact: null })]),
    ], true);
    expect(findings[0].priority).toBe('recommended');
  });
});

describe('generateAccessibilityFindings — content', () => {
  it('surfaces WCAG-tagged criteria in the finding title', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/', [violation({
        id: 'color-contrast', impact: 'serious',
        tags: ['cat.color', 'wcag2aa', 'wcag143', 'TTv5', 'ACT'],
      })]),
    ], true);
    expect(findings[0].title_en).toContain('wcag2aa');
    expect(findings[0].title_en).toContain('wcag143');
    // Non-wcag tags should NOT appear in the title (we filter to wcag* only)
    expect(findings[0].title_en).not.toContain('cat.color');
    expect(findings[0].title_en).not.toContain('TTv5');
  });

  it('embeds the axe helpUrl in the recommendation', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/', [violation({
        id: 'color-contrast', impact: 'serious',
        helpUrl: 'https://docs.example/color-contrast',
      })]),
    ], true);
    expect(findings[0].recommendation_en).toContain('https://docs.example/color-contrast');
  });

  it('uses module=accessibility on every emitted finding', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/', [violation({ id: 'color-contrast', impact: 'serious' })]),
    ], true);
    expect(findings.every(f => f.module === 'accessibility')).toBe(true);
  });

  it('sorts critical clusters first, then by total node count desc', () => {
    const findings = generateAccessibilityFindings([
      pageAt('https://x.com/a', [
        violation({ id: 'small-issue', impact: 'minor' }),
        violation({ id: 'big-issue', impact: 'critical' }),
        violation({ id: 'mid-issue', impact: 'moderate' }),
      ]),
    ], true);
    expect(findings[0].priority).toBe('critical');
    // Last should be the minor one
    expect(findings[findings.length - 1].priority).toBe('optional');
  });
});
