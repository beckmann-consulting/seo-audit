import { describe, it, expect } from 'vitest';
import { generateJsRenderingFindings } from './tech';
import type { PageSEOData, HttpError } from '@/types';

// Reuses the same minimal-page factory as tech-js-rendering.test.ts.
// Kept local to avoid coupling with that test file's internals.
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
    renderMode: 'js',
    staticWordCount: 200,   // matches wordCount so js-rendering-required doesn't fire
    ...partial,
  };
}

const httpErr = (url: string, status: number, resourceType: string): HttpError =>
  ({ url, status, resourceType });

function findById(findings: ReturnType<typeof generateJsRenderingFindings>, predicate: (title: string) => boolean) {
  return findings.find(f => predicate(f.title_en));
}

describe('failed-network-requests — Important via httpErrors (same-origin, critical resource)', () => {
  it('flags Important when ≥1 httpError on a same-origin script', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        httpErrors: [httpErr('https://example.com/app.js', 404, 'script')],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('important');
    expect(f!.title_en).toContain('1 of them critical');
  });

  it('flags Important when ≥1 httpError on a same-origin stylesheet', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        httpErrors: [httpErr('https://example.com/main.css', 500, 'stylesheet')],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('important');
  });

  it('flags Important on a same-origin xhr 503', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        httpErrors: [httpErr('https://example.com/api/data', 503, 'xhr')],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('important');
  });
});

describe('failed-network-requests — Important via failedRequests (URL-pattern heuristic)', () => {
  it('flags Important when failedRequests has same-origin .js URL', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        failedRequests: ['https://example.com/bundle.js: net::ERR_ABORTED'],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('important');
  });

  it('flags Important when failedRequests has same-origin .css URL with query string', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        failedRequests: ['https://example.com/style.css?v=2: net::ERR_FAILED'],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('important');
  });

  it('flags Important when failedRequests has same-origin .mjs URL', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        failedRequests: ['https://example.com/module.mjs: net::ERR_NAME_NOT_RESOLVED'],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('important');
  });
});

describe('failed-network-requests — Recommended on cross-origin / non-critical', () => {
  it('flags Recommended on cross-origin script (third-party tracker)', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        httpErrors: [httpErr('https://google-analytics.com/analytics.js', 404, 'script')],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('recommended');
    expect(f!.title_en).not.toContain('critical');
  });

  it('flags Recommended on same-origin image (non-critical resourceType)', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        httpErrors: [httpErr('https://example.com/hero.png', 404, 'image')],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('recommended');
  });

  it('flags Recommended on same-origin font (failedRequests but non-critical extension)', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        failedRequests: ['https://example.com/font.woff2: net::ERR_FAILED'],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('recommended');
  });

  it('flags Recommended on cross-origin .js (script extension but not same-origin)', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/foo',
        failedRequests: ['https://cdn.other.com/lib.js: net::ERR_TIMED_OUT'],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('recommended');
  });
});

describe('failed-network-requests — sub-domain counts as cross-origin', () => {
  it('treats api.example.com as cross-origin to www.example.com', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://www.example.com/foo',
        httpErrors: [httpErr('https://api.example.com/data', 500, 'xhr')],
      }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f!.priority).toBe('recommended');
  });
});

describe('failed-network-requests — clustering at >5 failures per page', () => {
  it('shows top failures per sample page and "(+N more)" overflow', () => {
    const manyFailures: HttpError[] = Array.from({ length: 7 }, (_, i) =>
      httpErr(`https://example.com/asset-${i}.png`, 404, 'image'),
    );
    const findings = generateJsRenderingFindings([
      page({ url: 'https://example.com/page1', httpErrors: manyFailures }),
    ]);
    const f = findById(findings, t => t.includes('failed network'));
    expect(f).toBeDefined();
    // 2 detail entries + "(+ 5 more)" overflow text
    expect(f!.description_en).toContain('+ 5 more');
  });
});

describe('failed-network-requests — site-aggregation & sample sizing', () => {
  it('produces ONE finding for many pages, not one per page', () => {
    const pages = Array.from({ length: 8 }, (_, i) => page({
      url: `https://example.com/p${i}`,
      httpErrors: [httpErr(`https://example.com/p${i}.js`, 404, 'script')],
    }));
    const findings = generateJsRenderingFindings(pages).filter(f => f.title_en.includes('failed network'));
    expect(findings).toHaveLength(1);
    // total counts in the title
    expect(findings[0].title_en).toContain('8 failed network');
    expect(findings[0].title_en).toContain('on 8 page(s)');
  });

  it('worst-offender pages surface in the sample (sorted by critical-count desc)', () => {
    const pages = [
      page({ url: 'https://example.com/light', httpErrors: [httpErr('https://google.com/g.js', 404, 'script')] }), // 0 critical
      page({ url: 'https://example.com/heavy', httpErrors: [
        httpErr('https://example.com/a.js', 404, 'script'),
        httpErr('https://example.com/b.js', 500, 'script'),
      ]}), // 2 critical
    ];
    const findings = generateJsRenderingFindings(pages);
    const f = findById(findings, t => t.includes('failed network'));
    // affectedUrl is the worst page
    expect(f!.affectedUrl).toBe('https://example.com/heavy');
  });
});

describe('failed-network-requests — no trigger', () => {
  it('produces no finding when both lists are empty', () => {
    const findings = generateJsRenderingFindings([
      page({ url: 'https://example.com/clean', httpErrors: [], failedRequests: [] }),
    ]);
    expect(findings.find(f => f.title_en.includes('failed network'))).toBeUndefined();
  });

  it('produces no finding when neither list is set at all (undefined)', () => {
    const findings = generateJsRenderingFindings([
      page({ url: 'https://example.com/clean' }),
    ]);
    expect(findings.find(f => f.title_en.includes('failed network'))).toBeUndefined();
  });

  it('does not run on static-only pages (renderMode !== js)', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/static',
        renderMode: 'static',
        staticWordCount: undefined,
        httpErrors: [httpErr('https://example.com/x.js', 404, 'script')],
      }),
    ]);
    expect(findings.find(f => f.title_en.includes('failed network'))).toBeUndefined();
  });
});
