import { describe, it, expect } from 'vitest';
import { generateGscFindings } from './gsc';
import type { GscData, GscResult, PageSEOData, SitemapInfo } from '@/types';

function pageAt(url: string): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: 500, hasCanonical: true,
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
  };
}

function makeGscData(opts: {
  topPages?: { url: string; impressions: number; ctr: number; position: number; clicks?: number }[];
} = {}): GscData {
  return {
    resolved: { siteUrl: 'sc-domain:example.com', variant: 'domain' },
    startDate: '2026-03-30',
    endDate: '2026-04-26',
    totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
    topQueries: [],
    topPages: (opts.topPages ?? []).map(p => ({
      keys: [p.url],
      clicks: p.clicks ?? Math.round(p.impressions * p.ctr),
      impressions: p.impressions,
      ctr: p.ctr,
      position: p.position,
    })),
  };
}

const okResult = (data: GscData): GscResult => ({ state: 'ok', data });

// ============================================================
//  Guard — only runs when gscResult.state === 'ok'
// ============================================================

describe('generateGscFindings — guard', () => {
  it('returns [] when gscResult is undefined', () => {
    expect(generateGscFindings([pageAt('https://x.com/')], undefined)).toEqual([]);
  });

  it('returns [] when state=disabled', () => {
    expect(generateGscFindings([pageAt('https://x.com/')], { state: 'disabled' })).toEqual([]);
  });

  it('returns [] when state=property-not-found', () => {
    expect(generateGscFindings(
      [pageAt('https://x.com/')],
      { state: 'property-not-found', domain: 'x.com', sitesAvailable: 5 },
    )).toEqual([]);
  });

  it('returns [] when state=api-error', () => {
    expect(generateGscFindings(
      [pageAt('https://x.com/')],
      { state: 'api-error', message: 'GSC 503' },
    )).toEqual([]);
  });

  it('returns [] when there are no pages', () => {
    expect(generateGscFindings([], okResult(makeGscData()))).toEqual([]);
  });
});

// ============================================================
//  gsc-indexing-issues
// ============================================================

describe('gsc-indexing-issues — Recommended @ >50%', () => {
  it('does NOT fire below the 50% threshold', () => {
    // 4/10 = 40% without impressions → no finding
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}`));
    const data = makeGscData({
      topPages: pages.slice(0, 6).map(p => ({ url: p.url, impressions: 200, ctr: 0.1, position: 5 })),
    });
    const findings = generateGscFindings(pages, okResult(data));
    expect(findings.find(f => f.title_en.includes('without impressions'))).toBeUndefined();
  });

  it('fires above the 50% threshold', () => {
    // 6/10 = 60% without impressions → fires
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}`));
    const data = makeGscData({
      topPages: pages.slice(0, 4).map(p => ({ url: p.url, impressions: 200, ctr: 0.1, position: 5 })),
    });
    const findings = generateGscFindings(pages, okResult(data));
    const f = findings.find(x => x.title_en.includes('without impressions'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('recommended');
    expect(f!.title_en).toContain('60%');
  });

  it('does NOT fire on tiny sites (<5 eligible pages) even at 100% miss rate', () => {
    // 3-page site, all without impressions → still no finding
    const pages = [
      pageAt('https://x.com/a'),
      pageAt('https://x.com/b'),
      pageAt('https://x.com/c'),
    ];
    const data = makeGscData({ topPages: [] });
    const findings = generateGscFindings(pages, okResult(data));
    expect(findings.find(f => f.title_en.includes('without impressions'))).toBeUndefined();
  });

  it('uses "without impressions" wording, not "not indexed"', () => {
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}`));
    const data = makeGscData({ topPages: [] }); // 100% miss
    const findings = generateGscFindings(pages, okResult(data));
    const f = findings.find(x => x.title_en.includes('without impressions'))!;
    expect(f.title_en.toLowerCase()).not.toContain('not indexed');
    expect(f.description_en.toLowerCase()).toContain('zero impressions');
  });

  it('excludes pages with sitemap lastmod < 30 days from the analysis', () => {
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}`));
    // GSC topPages: only first 3 have impressions (7/10 = 70% miss, would normally fire)
    const data = makeGscData({
      topPages: pages.slice(0, 3).map(p => ({ url: p.url, impressions: 200, ctr: 0.1, position: 5 })),
    });
    // But sitemap says pages 3,4,5,6,7,8,9 are all fresh — only 3 eligible (<5),
    // so the indexing-issues finding shouldn't fire even though the bare miss
    // rate is 70%.
    const recentLastmod = new Date(Date.now() - 7 * 86400_000).toISOString();
    const sitemap: SitemapInfo = {
      urls: pages.slice(3).map(p => ({
        url: p.url, lastmod: recentLastmod, imageCount: 0,
      })),
      isIndex: false,
      subSitemaps: [],
    };
    const findings = generateGscFindings(pages, okResult(data), sitemap);
    expect(findings.find(f => f.title_en.includes('without impressions'))).toBeUndefined();
  });

  it('keeps pages with old sitemap lastmod (>30 days) in the analysis', () => {
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}`));
    const data = makeGscData({
      topPages: pages.slice(0, 4).map(p => ({ url: p.url, impressions: 200, ctr: 0.1, position: 5 })),
    });
    // Sitemap says everything is OLD — full eligibility, 60% miss → fires.
    const oldLastmod = new Date(Date.now() - 365 * 86400_000).toISOString();
    const sitemap: SitemapInfo = {
      urls: pages.map(p => ({ url: p.url, lastmod: oldLastmod, imageCount: 0 })),
      isIndex: false,
      subSitemaps: [],
    };
    const findings = generateGscFindings(pages, okResult(data), sitemap);
    expect(findings.find(f => f.title_en.includes('without impressions'))).toBeDefined();
  });

  it('handles trailing-slash differences between GSC keys and crawled URLs', () => {
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}/`));
    const data = makeGscData({
      // GSC returns URLs without trailing slash — both should normalize and match
      topPages: pages.slice(0, 6).map(p => ({
        url: p.url.replace(/\/$/, ''), impressions: 200, ctr: 0.1, position: 5,
      })),
    });
    const findings = generateGscFindings(pages, okResult(data));
    // 6 with impressions / 10 total = 40% miss → below threshold
    expect(findings.find(f => f.title_en.includes('without impressions'))).toBeUndefined();
  });
});

// ============================================================
//  low-ctr-high-impressions
// ============================================================

describe('low-ctr-high-impressions — Optional', () => {
  it('fires for impressions > 100 + ctr < 2% + position <= 10', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/a', impressions: 500, ctr: 0.015, position: 6 },
      ],
    });
    const findings = generateGscFindings([pageAt('https://x.com/')], okResult(data));
    const f = findings.find(x => x.title_en.includes('low CTR'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('optional');
    expect(f!.description_en).toContain('500 Impressions');
    expect(f!.description_en).toContain('1.5% CTR');
  });

  it('does NOT fire when position > 10 (page 2+ low CTR is normal)', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/a', impressions: 500, ctr: 0.015, position: 14 },
      ],
    });
    const findings = generateGscFindings([pageAt('https://x.com/')], okResult(data));
    expect(findings.find(x => x.title_en.includes('low CTR'))).toBeUndefined();
  });

  it('does NOT fire when impressions <= 100', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/a', impressions: 80, ctr: 0.01, position: 5 },
      ],
    });
    expect(generateGscFindings([pageAt('https://x.com/')], okResult(data))
      .find(f => f.title_en.includes('low CTR'))).toBeUndefined();
  });

  it('does NOT fire when CTR >= 2%', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/a', impressions: 500, ctr: 0.025, position: 5 },
      ],
    });
    expect(generateGscFindings([pageAt('https://x.com/')], okResult(data))
      .find(f => f.title_en.includes('low CTR'))).toBeUndefined();
  });

  it('respects boundary: impressions 101 + ctr 0.019 + position 10 → fires', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/a', impressions: 101, ctr: 0.019, position: 10 },
      ],
    });
    const findings = generateGscFindings([pageAt('https://x.com/')], okResult(data));
    expect(findings.find(x => x.title_en.includes('low CTR'))).toBeDefined();
  });

  it('respects boundary: position 10.0 fires, 10.5 does not', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/at', impressions: 200, ctr: 0.015, position: 10.0 },
        { url: 'https://x.com/over', impressions: 200, ctr: 0.015, position: 10.5 },
      ],
    });
    const findings = generateGscFindings([pageAt('https://x.com/')], okResult(data));
    const f = findings.find(x => x.title_en.includes('low CTR'))!;
    expect(f.title_en).toContain('1 page'); // only one page qualifies
  });

  it('sorts the sample by impressions desc (worst first)', () => {
    const data = makeGscData({
      topPages: [
        { url: 'https://x.com/medium', impressions: 200, ctr: 0.01, position: 5 },
        { url: 'https://x.com/biggest', impressions: 5000, ctr: 0.005, position: 3 },
        { url: 'https://x.com/small', impressions: 110, ctr: 0.018, position: 7 },
      ],
    });
    const findings = generateGscFindings([pageAt('https://x.com/')], okResult(data));
    const f = findings.find(x => x.title_en.includes('low CTR'))!;
    expect(f.description_en.indexOf('biggest')).toBeLessThan(f.description_en.indexOf('medium'));
    expect(f.description_en.indexOf('medium')).toBeLessThan(f.description_en.indexOf('small'));
  });

  it('caps the sample at 5', () => {
    const data = makeGscData({
      topPages: Array.from({ length: 12 }, (_, i) => ({
        url: `https://x.com/p${i}`, impressions: 500 + i, ctr: 0.01, position: 5,
      })),
    });
    const findings = generateGscFindings([pageAt('https://x.com/')], okResult(data));
    const f = findings.find(x => x.title_en.includes('low CTR'))!;
    const examples = f.description_en.match(/https:\/\/x\.com\/p\d+/g) || [];
    expect(examples.length).toBe(5);
  });
});

// ============================================================
//  Both findings can co-emit
// ============================================================

describe('co-emission', () => {
  it('a site with both indexing AND CTR issues emits both findings', () => {
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/p${i}`));
    const data = makeGscData({
      // First 3 pages have impressions (so 7/10 = 70% miss → indexing fires)
      // First page also has low CTR + page-1 position → low-ctr fires
      topPages: [
        { url: 'https://x.com/p0', impressions: 500, ctr: 0.01, position: 4 },
        { url: 'https://x.com/p1', impressions: 200, ctr: 0.10, position: 3 },
        { url: 'https://x.com/p2', impressions: 200, ctr: 0.10, position: 3 },
      ],
    });
    const findings = generateGscFindings(pages, okResult(data));
    expect(findings).toHaveLength(2);
    expect(findings.find(f => f.title_en.includes('without impressions'))).toBeDefined();
    expect(findings.find(f => f.title_en.includes('low CTR'))).toBeDefined();
  });
});
