import { describe, it, expect } from 'vitest';
import { generateTouchTargetFindings } from './ux';
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

describe('generateTouchTargetFindings', () => {
  it('returns no findings on empty input', () => {
    expect(generateTouchTargetFindings([])).toHaveLength(0);
  });

  it('returns no findings when no page contributed any small targets', () => {
    expect(generateTouchTargetFindings([page({ smallTouchTargetCount: 0 })])).toHaveLength(0);
  });

  it('emits a Recommended finding aggregating across pages', () => {
    const findings = generateTouchTargetFindings([
      page({ url: 'https://example.com/a', smallTouchTargetCount: 3 }),
      page({ url: 'https://example.com/b', smallTouchTargetCount: 2 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('recommended');
    expect(findings[0].title_en).toContain('5 element');
    expect(findings[0].title_en).toContain('2 page');
  });

  it('only mentions affected pages in the sample (not pages with 0)', () => {
    const findings = generateTouchTargetFindings([
      page({ url: 'https://example.com/clean', smallTouchTargetCount: 0 }),
      page({ url: 'https://example.com/affected', smallTouchTargetCount: 1 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].description_en).toContain('https://example.com/affected');
    expect(findings[0].description_en).not.toContain('https://example.com/clean');
  });

  it('caps the sample at 5 affected pages', () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      page({ url: `https://example.com/${i}`, smallTouchTargetCount: 1 }),
    );
    const findings = generateTouchTargetFindings(pages);
    expect(findings).toHaveLength(1);
    const examples = (findings[0].description_en.match(/https:\/\/example\.com\/\d/g) || []);
    expect(examples.length).toBe(5);
  });

  it('mentions the 48px threshold from the WCAG / Material guidance', () => {
    const findings = generateTouchTargetFindings([
      page({ smallTouchTargetCount: 1 }),
    ]);
    expect(findings[0].description_en).toContain('48');
    expect(findings[0].recommendation_en).toContain('48');
  });
});
