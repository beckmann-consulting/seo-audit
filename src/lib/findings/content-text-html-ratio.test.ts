import { describe, it, expect } from 'vitest';
import { generateTextHtmlRatioFindings } from './content';
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

describe('generateTextHtmlRatioFindings', () => {
  it('returns no findings for empty page list', () => {
    expect(generateTextHtmlRatioFindings([])).toHaveLength(0);
  });

  it('returns no findings when all ratios are healthy', () => {
    const findings = generateTextHtmlRatioFindings([
      page({ textHtmlRatio: 0.20, wordCount: 500 }),
      page({ url: 'https://example.com/x', textHtmlRatio: 0.15, wordCount: 300 }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('flags pages with ratio < 10%', () => {
    const findings = generateTextHtmlRatioFindings([
      page({ url: 'https://example.com/heavy', textHtmlRatio: 0.05, wordCount: 200 }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('optional');
    expect(findings[0].title_en).toContain('1 page');
    expect(findings[0].description_en).toContain('5.0%');
  });

  it('skips pages under 100 words even if their ratio is low', () => {
    // Thin pages already produce noisy ratios and have their own
    // dedicated finding, so we exclude them here.
    const findings = generateTextHtmlRatioFindings([
      page({ url: 'https://example.com/thin', textHtmlRatio: 0.04, wordCount: 50 }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('skips pages with ratio == 0 (extraction failure)', () => {
    // textHtmlRatio = 0 means we couldn't measure body text at all —
    // probably an extraction edge case rather than a real low-ratio page.
    const findings = generateTextHtmlRatioFindings([
      page({ url: 'https://example.com/x', textHtmlRatio: 0, wordCount: 200 }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('respects the boundary precisely (0.099 fires, 0.10 does not)', () => {
    expect(generateTextHtmlRatioFindings([page({ textHtmlRatio: 0.099, wordCount: 200 })])).toHaveLength(1);
    expect(generateTextHtmlRatioFindings([page({ textHtmlRatio: 0.10, wordCount: 200 })])).toHaveLength(0);
  });

  it('aggregates multiple low-ratio pages into a single finding', () => {
    const pages = Array.from({ length: 8 }, (_, i) => page({
      url: `https://example.com/${i}`,
      textHtmlRatio: 0.04 + i * 0.005,
      wordCount: 200,
    }));
    const findings = generateTextHtmlRatioFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('8 page');
    // Sample shows up to 5 URLs
    const examples = findings[0].description_en.match(/https:\/\/example\.com\/\d/g) || [];
    expect(examples.length).toBe(5);
  });
});
