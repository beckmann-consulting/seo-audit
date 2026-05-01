import { describe, it, expect } from 'vitest';
import { generateBingFindings } from './bing';
import type { BingResult, BingRow, PageSEOData } from '@/types';

// Minimal page factory — same shape used by tech-failed-network and
// tech-hydration test files. Reuse keeps the test surface uniform.
function page(partial: Partial<PageSEOData>): PageSEOData {
  return {
    url: 'https://example.com/',
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: partial.url ?? 'https://example.com/',
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: 200, hasCanonical: true,
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
    ...partial,
  };
}

const pageRow = (page: string, impressions: number): BingRow => ({
  page,
  clicks: 0,
  impressions,
  ctr: 0,
  position: 0,
});

const queryRow = (
  query: string,
  impressions: number,
  ctr: number,
  position: number,
): BingRow => ({
  query,
  clicks: Math.round(impressions * ctr),
  impressions,
  ctr,
  position,
});

function okResult(opts: { topPages?: BingRow[]; topQueries?: BingRow[] } = {}): BingResult {
  return {
    state: 'ok',
    data: {
      siteUrl: 'https://example.com/',
      totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      topPages: opts.topPages ?? [],
      topQueries: opts.topQueries ?? [],
    },
  };
}

const findByTitleSubstring = (
  findings: ReturnType<typeof generateBingFindings>,
  needle: string,
) => findings.find(f => f.title_en.toLowerCase().includes(needle.toLowerCase()));

// ============================================================
//  bing-low-coverage
// ============================================================

describe('bing-low-coverage — trigger conditions', () => {
  it('triggers when 70% of crawled pages have no Bing impressions (above 50% threshold)', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page({ url: `https://example.com/p${i}` }));
    // Only 3 of 10 pages registered any Bing impressions → 70% missing.
    const topPages = [
      pageRow('https://example.com/p0', 100),
      pageRow('https://example.com/p1', 50),
      pageRow('https://example.com/p2', 25),
    ];
    const findings = generateBingFindings(pages, okResult({ topPages }));
    const f = findByTitleSubstring(findings, 'without Bing impressions');
    expect(f).toBeDefined();
    expect(f!.priority).toBe('recommended');
    expect(f!.title_en).toContain('7 of 10');
    expect(f!.title_en).toContain('70%');
  });

  it('does NOT trigger at exactly 50% missing (threshold is strictly > 0.5)', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page({ url: `https://example.com/p${i}` }));
    // 5 of 10 pages with impressions = 50% missing — NOT > 0.5.
    const topPages = Array.from({ length: 5 }, (_, i) =>
      pageRow(`https://example.com/p${i}`, 100),
    );
    const findings = generateBingFindings(pages, okResult({ topPages }));
    expect(findByTitleSubstring(findings, 'without Bing impressions')).toBeUndefined();
  });

  it('does NOT trigger when fewer than 5 pages were crawled (sample-size bypass)', () => {
    const pages = [
      page({ url: 'https://example.com/a' }),
      page({ url: 'https://example.com/b' }),
      page({ url: 'https://example.com/c' }),
    ];
    // 0 of 3 have impressions — but pages.length < 5, so no finding.
    const findings = generateBingFindings(pages, okResult({ topPages: [] }));
    expect(findByTitleSubstring(findings, 'without Bing impressions')).toBeUndefined();
  });

  it('matches across trailing-slash variation (uses url-normalize)', () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      page({ url: `https://example.com/p${i}` }),
    );
    // Bing returns the URLs WITH trailing slash; the crawler stored
    // them without. Normalisation must equate the two.
    const topPages = [
      pageRow('https://example.com/p0/', 100),
      pageRow('https://example.com/p1/', 100),
      pageRow('https://example.com/p2/', 100),
      pageRow('https://example.com/p3/', 100),
      pageRow('https://example.com/p4/', 100),
      pageRow('https://example.com/p5/', 100),
    ];
    const findings = generateBingFindings(pages, okResult({ topPages }));
    expect(findByTitleSubstring(findings, 'without Bing impressions')).toBeUndefined();
  });
});

// ============================================================
//  bing-low-ctr-high-impressions
// ============================================================

describe('bing-low-ctr-high-impressions — trigger conditions', () => {
  it('triggers on a query with high impressions, low CTR, page-1 position', () => {
    const findings = generateBingFindings(
      [page({ url: 'https://example.com/x' })],
      okResult({ topQueries: [queryRow('seo audit', 200, 0.01, 5.0)] }),
    );
    const f = findByTitleSubstring(findings, 'low CTR');
    expect(f).toBeDefined();
    expect(f!.priority).toBe('optional');
    expect(f!.description_en).toContain('seo audit');
    expect(f!.description_en).toContain('200 Impressions');
    expect(f!.description_en).toContain('1.0% CTR');
  });

  it('does NOT trigger when impressions are too low (≤100)', () => {
    const findings = generateBingFindings(
      [page({})],
      okResult({ topQueries: [queryRow('low-traffic', 50, 0.005, 4.0)] }),
    );
    expect(findByTitleSubstring(findings, 'low CTR')).toBeUndefined();
  });

  it('does NOT trigger when position is page-2 or worse (>10)', () => {
    const findings = generateBingFindings(
      [page({})],
      okResult({ topQueries: [queryRow('page-two', 500, 0.005, 15.2)] }),
    );
    expect(findByTitleSubstring(findings, 'low CTR')).toBeUndefined();
  });

  it('does NOT trigger when CTR is at/above 1.5% (boundary)', () => {
    const findings = generateBingFindings(
      [page({})],
      okResult({ topQueries: [queryRow('ok-ctr', 500, 0.015, 5.0)] }),
    );
    expect(findByTitleSubstring(findings, 'low CTR')).toBeUndefined();
  });

  it('clusters multiple offenders and shows top-3 worst by impressions', () => {
    const queries = [
      queryRow('q1', 1000, 0.005, 4.0),
      queryRow('q2', 500, 0.01, 6.0),
      queryRow('q3', 300, 0.012, 8.0),
      queryRow('q4', 200, 0.008, 7.0),  // 4th-worst, should NOT appear in sample
      queryRow('q5', 150, 0.007, 9.0),  // 5th-worst, should NOT appear
    ];
    const findings = generateBingFindings([page({})], okResult({ topQueries: queries }));
    const f = findByTitleSubstring(findings, 'low CTR');
    expect(f).toBeDefined();
    expect(f!.title_en).toContain('5');
    // Top 3 (q1, q2, q3) appear in description
    expect(f!.description_en).toContain('q1');
    expect(f!.description_en).toContain('q2');
    expect(f!.description_en).toContain('q3');
    expect(f!.description_en).not.toContain('q4');
    expect(f!.description_en).not.toContain('q5');
  });
});

// ============================================================
//  Gating — bingResult states
// ============================================================

describe('generateBingFindings — state gating', () => {
  const triggeringPages = Array.from({ length: 6 }, (_, i) => page({ url: `https://example.com/p${i}` }));
  const triggeringQueries: BingRow[] = [queryRow('hot query', 200, 0.005, 3.0)];

  it('returns [] when bingResult is undefined', () => {
    expect(generateBingFindings(triggeringPages, undefined)).toEqual([]);
  });

  it('returns [] when bingResult.state === "disabled"', () => {
    expect(generateBingFindings(triggeringPages, { state: 'disabled' })).toEqual([]);
  });

  it('returns [] when bingResult.state === "site-not-found"', () => {
    expect(generateBingFindings(
      triggeringPages,
      { state: 'site-not-found', siteUrl: 'https://example.com/' },
    )).toEqual([]);
  });

  it('returns [] when bingResult.state === "api-error"', () => {
    expect(generateBingFindings(
      triggeringPages,
      { state: 'api-error', message: 'Bing 503' },
    )).toEqual([]);
  });

  it('returns [] when pages array is empty even with ok result', () => {
    expect(generateBingFindings([], okResult({ topQueries: triggeringQueries }))).toEqual([]);
  });
});

// ============================================================
//  Wording smoke tests — DE/EN both populated
// ============================================================

describe('generateBingFindings — DE/EN wording', () => {
  it('emits both German and English copy on the coverage finding', () => {
    const pages = Array.from({ length: 8 }, (_, i) => page({ url: `https://example.com/p${i}` }));
    const findings = generateBingFindings(pages, okResult({ topPages: [] }));
    const f = findByTitleSubstring(findings, 'without Bing impressions');
    expect(f!.title_de).toContain('Bing-Impressions');
    expect(f!.recommendation_de).toContain('Bing Webmaster');
    expect(f!.recommendation_en).toContain('Bing Webmaster');
  });

  it('emits both German and English copy on the low-CTR finding', () => {
    const findings = generateBingFindings(
      [page({})],
      okResult({ topQueries: [queryRow('test', 200, 0.005, 3.0)] }),
    );
    const f = findByTitleSubstring(findings, 'low CTR');
    expect(f!.title_de).toContain('niedrigem CTR');
    expect(f!.recommendation_de).toMatch(/Title-Tag/i);
    expect(f!.recommendation_en).toMatch(/title tag/i);
  });
});
