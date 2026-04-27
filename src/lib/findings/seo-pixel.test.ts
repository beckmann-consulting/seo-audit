import { describe, it, expect } from 'vitest';
import { generatePixelWidthFindings } from './seo';
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
    bodyTextHash: '', bodyMinhash: [], textHtmlRatio: 0.2,
    ...partial,
  };
}

describe('generatePixelWidthFindings', () => {
  it('returns no findings for empty page list', () => {
    expect(generatePixelWidthFindings([])).toHaveLength(0);
  });

  it('returns no findings when titles and descriptions fit', () => {
    const findings = generatePixelWidthFindings([
      page({ title: 'Short title', titleLength: 11, titlePixelWidth: 80 }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('flags a title pixel overrun (>580px)', () => {
    const findings = generatePixelWidthFindings([
      page({ title: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', titleLength: 32, titlePixelWidth: 605 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('recommended');
    expect(findings[0].title_en).toContain('mobile SERP');
    expect(findings[0].title_en).toContain('580px');
  });

  it('flags a meta-description pixel overrun (>990px)', () => {
    const longDesc = 'A'.repeat(120);
    const findings = generatePixelWidthFindings([
      page({ metaDescription: longDesc, metaDescriptionLength: 120, metaDescriptionPixelWidth: 1050 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('recommended');
    expect(findings[0].title_en).toContain('990px');
  });

  it('flags both title and description when both exceed', () => {
    const findings = generatePixelWidthFindings([
      page({ titlePixelWidth: 700 }),
      page({ url: 'https://example.com/x', metaDescriptionPixelWidth: 1100 }),
    ]);
    expect(findings).toHaveLength(2);
    const titles = findings.map(f => f.title_en);
    expect(titles.some(t => t.includes('title tag'))).toBe(true);
    expect(titles.some(t => t.includes('meta description'))).toBe(true);
  });

  it('does not error on pages where the field is missing', () => {
    expect(() => generatePixelWidthFindings([page({})])).not.toThrow();
    expect(generatePixelWidthFindings([page({})])).toHaveLength(0);
  });

  it('respects exact threshold boundary (580px is OK, 581px is not)', () => {
    const at = generatePixelWidthFindings([page({ titlePixelWidth: 580 })]);
    expect(at).toHaveLength(0);
    const over = generatePixelWidthFindings([page({ titlePixelWidth: 581 })]);
    expect(over).toHaveLength(1);
  });
});
