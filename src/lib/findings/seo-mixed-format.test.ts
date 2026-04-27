import { describe, it, expect } from 'vitest';
import { generateMixedStructuredDataFindings } from './seo';
import type { PageSEOData } from '@/types';

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

describe('generateMixedStructuredDataFindings', () => {
  it('returns no findings for empty page list', () => {
    expect(generateMixedStructuredDataFindings([])).toHaveLength(0);
  });

  it('returns no findings when no page has any structured data', () => {
    expect(generateMixedStructuredDataFindings([page({})])).toHaveLength(0);
  });

  it('returns no findings when only one format is in use site-wide', () => {
    const pages = [
      page({ url: 'https://example.com/a', hasJsonLd: true }),
      page({ url: 'https://example.com/b', hasJsonLd: true }),
    ];
    expect(generateMixedStructuredDataFindings(pages)).toHaveLength(0);
  });

  it('returns no findings when formats are split across pages but never overlap on one page', () => {
    // a/ has only JSON-LD, b/ has only Microdata. Each page has 1 format.
    const pages = [
      page({ url: 'https://example.com/a', hasJsonLd: true }),
      page({ url: 'https://example.com/b', hasMicrodata: true }),
    ];
    expect(generateMixedStructuredDataFindings(pages)).toHaveLength(0);
  });

  it('flags a page that publishes JSON-LD AND Microdata', () => {
    const pages = [
      page({ url: 'https://example.com/p', hasJsonLd: true, hasMicrodata: true }),
    ];
    const findings = generateMixedStructuredDataFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('optional');
    expect(findings[0].title_en).toContain('1 page');
    expect(findings[0].description_en).toContain('JSON-LD');
    expect(findings[0].description_en).toContain('Microdata');
  });

  it('lists all three formats in the description when applicable', () => {
    const pages = [
      page({ url: 'https://example.com/p', hasJsonLd: true, hasMicrodata: true, hasRdfa: true }),
    ];
    const findings = generateMixedStructuredDataFindings(pages);
    expect(findings[0].description_en).toContain('JSON-LD');
    expect(findings[0].description_en).toContain('Microdata');
    expect(findings[0].description_en).toContain('RDFa');
  });

  it('aggregates the affected-page count across the crawl', () => {
    const pages = [
      page({ url: 'https://example.com/a', hasJsonLd: true, hasMicrodata: true }),
      page({ url: 'https://example.com/b', hasJsonLd: true, hasMicrodata: true }),
      page({ url: 'https://example.com/c', hasJsonLd: true }), // not mixed
    ];
    const findings = generateMixedStructuredDataFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('2 page');
  });

  it('samples up to 3 affected URLs in the description', () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      page({ url: `https://example.com/${i}`, hasJsonLd: true, hasMicrodata: true })
    );
    const findings = generateMixedStructuredDataFindings(pages);
    expect(findings).toHaveLength(1);
    // Description contains 3 example URLs (first 3 by definition)
    expect(findings[0].description_en).toContain('https://example.com/0');
    expect(findings[0].description_en).toContain('https://example.com/1');
    expect(findings[0].description_en).toContain('https://example.com/2');
    expect(findings[0].description_en).not.toContain('https://example.com/9');
  });
});
