import { describe, it, expect } from 'vitest';
import { generateCanonicalTargetFindings } from './seo';
import type { PageSEOData } from '@/types';

function page(partial: Partial<PageSEOData>): PageSEOData {
  return {
    url: partial.url ?? 'https://example.com/',
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: partial.url ?? 'https://example.com/',
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
    ...partial,
  };
}

const findBroken = (findings: ReturnType<typeof generateCanonicalTargetFindings>) =>
  findings.find(f => /points to (?:4xx|redirect|4xx or redirect)/.test(f.title_en));
const findNoindex = (findings: ReturnType<typeof generateCanonicalTargetFindings>) =>
  findings.find(f => f.title_en.includes('noindex'));

// ============================================================
//  broken-target
// ============================================================

describe('canonical-broken-target — 4xx target', () => {
  it('triggers when canonical points to a 4xx URL recorded in errorPages', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/dead',
      }),
    ];
    const errorPages = [{ url: 'https://example.com/dead', status: 404 }];
    const f = findBroken(generateCanonicalTargetFindings(pages, errorPages));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('important');
    expect(f!.description_en).toContain('HTTP 404');
  });

  it('matches across trailing-slash variation', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/dead', // no trailing slash
      }),
    ];
    const errorPages = [{ url: 'https://example.com/dead/', status: 410 }]; // trailing slash
    const f = findBroken(generateCanonicalTargetFindings(pages, errorPages));
    expect(f).toBeDefined();
    expect(f!.description_en).toContain('HTTP 410');
  });
});

describe('canonical-broken-target — redirect target', () => {
  it('triggers when canonical points to a page that itself redirected', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/old-target',
      }),
      page({
        url: 'https://example.com/new-target',
        finalUrl: 'https://example.com/new-target',
        redirectChain: ['https://example.com/old-target'],
      }),
    ];
    const f = findBroken(generateCanonicalTargetFindings(pages, []));
    expect(f).toBeDefined();
    expect(f!.description_en).toContain('https://example.com/new-target');
  });

  it('does NOT trigger on a clean 200 target', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/target',
      }),
      page({
        url: 'https://example.com/target',
        finalUrl: 'https://example.com/target',
        // no redirect, no errors
      }),
    ];
    expect(findBroken(generateCanonicalTargetFindings(pages, []))).toBeUndefined();
  });

  it('does NOT trigger when target was not crawled (out of scope)', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/never-crawled',
      }),
    ];
    expect(findBroken(generateCanonicalTargetFindings(pages, []))).toBeUndefined();
  });

  it('does NOT trigger on self-canonical', () => {
    const pages = [
      page({
        url: 'https://example.com/foo',
        canonicalUrl: 'https://example.com/foo',
      }),
    ];
    expect(findBroken(generateCanonicalTargetFindings(pages, []))).toBeUndefined();
  });
});

// ============================================================
//  noindex-conflict
// ============================================================

describe('canonical-noindex-conflict — meta + header', () => {
  it('triggers when canonical points to a page with hasNoindex=true', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/no-index-target',
      }),
      page({
        url: 'https://example.com/no-index-target',
        finalUrl: 'https://example.com/no-index-target',
        hasNoindex: true,
      }),
    ];
    const f = findNoindex(generateCanonicalTargetFindings(pages, []));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('important');
    expect(f!.description_en).toContain('<meta robots>');
  });

  it('triggers when canonical points to a page with xRobotsNoindex=true', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/no-index-target',
      }),
      page({
        url: 'https://example.com/no-index-target',
        finalUrl: 'https://example.com/no-index-target',
        xRobotsNoindex: true,
      }),
    ];
    const f = findNoindex(generateCanonicalTargetFindings(pages, []));
    expect(f).toBeDefined();
    expect(f!.description_en).toContain('X-Robots-Tag header');
  });

  it('does NOT trigger when target has neither directive', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/clean-target',
      }),
      page({
        url: 'https://example.com/clean-target',
        finalUrl: 'https://example.com/clean-target',
      }),
    ];
    expect(findNoindex(generateCanonicalTargetFindings(pages, []))).toBeUndefined();
  });

  it('does NOT trigger on self-canonical even when the page itself has noindex', () => {
    // A page noindex-canonicalising to itself is a different concern
    // (= explicit "do not index me"); we only flag cross-page
    // canonical-vs-noindex contradictions.
    const pages = [
      page({
        url: 'https://example.com/foo',
        canonicalUrl: 'https://example.com/foo',
        hasNoindex: true,
      }),
    ];
    expect(findNoindex(generateCanonicalTargetFindings(pages, []))).toBeUndefined();
  });
});

// ============================================================
//  Aggregation + edge cases
// ============================================================

describe('aggregation', () => {
  it('counts every source pointing at a problematic target, sample limited to top-3', () => {
    const sources = Array.from({ length: 5 }, (_, i) =>
      page({
        url: `https://example.com/s${i}`,
        canonicalUrl: 'https://example.com/dead',
      }),
    );
    const errorPages = [{ url: 'https://example.com/dead', status: 404 }];
    const f = findBroken(generateCanonicalTargetFindings(sources, errorPages));
    expect(f).toBeDefined();
    expect(f!.title_en).toContain('5 page(s)');
    // Top-3 sample
    expect(f!.description_en).toMatch(/s0[\s\S]*s1[\s\S]*s2/);
    expect(f!.description_en).not.toContain('s3');
    expect(f!.description_en).not.toContain('s4');
  });

  it('handles mixed broken-target reasons (4xx + redirect) in one finding', () => {
    const pages = [
      page({
        url: 'https://example.com/s1',
        canonicalUrl: 'https://example.com/dead',
      }),
      page({
        url: 'https://example.com/s2',
        canonicalUrl: 'https://example.com/old',
      }),
      page({
        url: 'https://example.com/new',
        finalUrl: 'https://example.com/new',
        redirectChain: ['https://example.com/old'],
      }),
    ];
    const errorPages = [{ url: 'https://example.com/dead', status: 404 }];
    const f = findBroken(generateCanonicalTargetFindings(pages, errorPages));
    expect(f).toBeDefined();
    expect(f!.title_en).toContain('4xx or redirect');
    expect(f!.title_en).toContain('2 page(s)');
  });
});

describe('edge cases', () => {
  it('returns [] for an empty pages array', () => {
    expect(generateCanonicalTargetFindings([], [])).toEqual([]);
  });

  it('skips relative canonicals (covered by the existing relative-canonical finding)', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: '/relative-target',
      }),
    ];
    expect(generateCanonicalTargetFindings(pages, [])).toEqual([]);
  });

  it('emits both broken and noindex findings when both conditions are present', () => {
    const pages = [
      page({
        url: 'https://example.com/s1',
        canonicalUrl: 'https://example.com/dead',
      }),
      page({
        url: 'https://example.com/s2',
        canonicalUrl: 'https://example.com/no-index-target',
      }),
      page({
        url: 'https://example.com/no-index-target',
        finalUrl: 'https://example.com/no-index-target',
        hasNoindex: true,
      }),
    ];
    const errorPages = [{ url: 'https://example.com/dead', status: 404 }];
    const findings = generateCanonicalTargetFindings(pages, errorPages);
    expect(findings).toHaveLength(2);
    expect(findBroken(findings)).toBeDefined();
    expect(findNoindex(findings)).toBeDefined();
  });
});

describe('DE/EN wording smoke', () => {
  it('emits both German and English copy on broken-target', () => {
    const pages = [
      page({
        url: 'https://example.com/source',
        canonicalUrl: 'https://example.com/dead',
      }),
    ];
    const f = findBroken(generateCanonicalTargetFindings(pages, [{ url: 'https://example.com/dead', status: 404 }]));
    expect(f!.title_de).toContain('Canonical');
    expect(f!.recommendation_de).toMatch(/Canonical|finale/);
    expect(f!.recommendation_en).toMatch(/canonical|final/);
  });

  it('emits both German and English copy on noindex-conflict', () => {
    const pages = [
      page({ url: 'https://example.com/source', canonicalUrl: 'https://example.com/t' }),
      page({ url: 'https://example.com/t', finalUrl: 'https://example.com/t', hasNoindex: true }),
    ];
    const f = findNoindex(generateCanonicalTargetFindings(pages, []));
    expect(f!.title_de).toContain('noindex');
    expect(f!.title_en).toContain('noindex');
    expect(f!.recommendation_de).toMatch(/noindex|Canonical/);
  });
});
