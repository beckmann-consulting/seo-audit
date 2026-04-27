import { describe, it, expect } from 'vitest';
import { generateReadabilityFindings } from './content';
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

describe('generateReadabilityFindings', () => {
  it('returns no findings for empty page list', () => {
    expect(generateReadabilityFindings([])).toHaveLength(0);
  });

  it('returns no findings when scores are healthy', () => {
    const findings = generateReadabilityFindings([
      page({ readabilityScore: 65, readabilityLang: 'en' }),
      page({ url: 'https://example.com/de', readabilityScore: 50, readabilityLang: 'de' }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('skips pages where the score is undefined (too thin to measure)', () => {
    const findings = generateReadabilityFindings([
      page({ readabilityScore: undefined, readabilityLang: undefined }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('flags an English page below 50', () => {
    const findings = generateReadabilityFindings([
      page({ url: 'https://example.com/en', readabilityScore: 35, readabilityLang: 'en' }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('optional');
    expect(findings[0].title_en).toContain('1 page');
    expect(findings[0].description_en).toContain('35');
    expect(findings[0].description_en).toContain('EN');
  });

  it('flags a German page below 30 but not above', () => {
    expect(generateReadabilityFindings([
      page({ readabilityScore: 25, readabilityLang: 'de' }),
    ])).toHaveLength(1);
    expect(generateReadabilityFindings([
      page({ readabilityScore: 35, readabilityLang: 'de' }),
    ])).toHaveLength(0);
  });

  it('uses language-specific thresholds (EN 50, DE 30)', () => {
    // Score 40: below 50 (EN flag), above 30 (DE OK)
    const enHit = generateReadabilityFindings([
      page({ readabilityScore: 40, readabilityLang: 'en' }),
    ]);
    const deClean = generateReadabilityFindings([
      page({ readabilityScore: 40, readabilityLang: 'de' }),
    ]);
    expect(enHit).toHaveLength(1);
    expect(deClean).toHaveLength(0);
  });

  it('respects the boundary precisely (49 fires, 50 does not for EN)', () => {
    expect(generateReadabilityFindings([
      page({ readabilityScore: 49, readabilityLang: 'en' }),
    ])).toHaveLength(1);
    expect(generateReadabilityFindings([
      page({ readabilityScore: 50, readabilityLang: 'en' }),
    ])).toHaveLength(0);
  });

  it('aggregates multiple low-score pages into one finding', () => {
    const pages = [
      page({ url: 'https://example.com/1', readabilityScore: 20, readabilityLang: 'en' }),
      page({ url: 'https://example.com/2', readabilityScore: 35, readabilityLang: 'en' }),
      page({ url: 'https://example.com/3', readabilityScore: 25, readabilityLang: 'de' }),
      page({ url: 'https://example.com/4', readabilityScore: 60, readabilityLang: 'en' }), // OK
    ];
    const findings = generateReadabilityFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('3 page');
  });
});
