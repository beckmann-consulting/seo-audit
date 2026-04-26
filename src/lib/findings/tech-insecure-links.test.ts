import { describe, it, expect } from 'vitest';
import { generateInsecureLinkFindings } from './tech';
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
    ...partial,
  };
}

describe('generateInsecureLinkFindings', () => {
  it('returns no findings when there are no pages', () => {
    expect(generateInsecureLinkFindings([])).toHaveLength(0);
  });

  it('returns no findings on a clean HTTPS site', () => {
    const findings = generateInsecureLinkFindings([
      page({ url: 'https://example.com/', internalLinks: ['https://example.com/about', 'https://example.com/contact'] }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('flags an internal http:// link on an https:// page', () => {
    const findings = generateInsecureLinkFindings([
      page({ url: 'https://example.com/', internalLinks: ['http://example.com/old-page'] }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('important');
    expect(findings[0].title_en).toContain('1 internal http:// link');
    expect(findings[0].description_en).toContain('http://example.com/old-page');
  });

  it('does NOT flag http:// links on http:// pages (not the same problem)', () => {
    // If the page itself is on http, it's a separate (broader) issue —
    // not what this finding is meant to catch.
    const findings = generateInsecureLinkFindings([
      page({ url: 'http://example.com/', internalLinks: ['http://example.com/old'] }),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('deduplicates by target URL but reports total link count', () => {
    const findings = generateInsecureLinkFindings([
      page({ url: 'https://example.com/a', internalLinks: ['http://example.com/old'] }),
      page({ url: 'https://example.com/b', internalLinks: ['http://example.com/old'] }),
      page({ url: 'https://example.com/c', internalLinks: ['http://example.com/old'] }),
    ]);
    expect(findings).toHaveLength(1);
    // Title counts unique targets (1)
    expect(findings[0].title_en).toContain('1 internal http://');
    // Description mentions affected pages (3) and total links (3)
    expect(findings[0].description_en).toContain('3 HTTPS page(s)');
    expect(findings[0].description_en).toContain('3 internal');
  });

  it('caps the sample at 10 unique targets', () => {
    const links = Array.from({ length: 25 }, (_, i) => `http://example.com/page-${i}`);
    const findings = generateInsecureLinkFindings([
      page({ url: 'https://example.com/', internalLinks: links }),
    ]);
    expect(findings).toHaveLength(1);
    // Description should mention 25 unique targets in the title but only show 10 examples
    expect(findings[0].title_en).toContain('25');
    const examples = findings[0].description_en.match(/http:\/\/example\.com\/page-\d+/g) || [];
    expect(examples.length).toBe(10);
  });

  it('does not double-count when the same source links twice to the same target', () => {
    const findings = generateInsecureLinkFindings([
      page({
        url: 'https://example.com/',
        internalLinks: ['http://example.com/x', 'http://example.com/x'],
      }),
    ]);
    expect(findings).toHaveLength(1);
    // 1 unique target, 1 source page (deduped)
    expect(findings[0].description_en).toContain('1 HTTPS page(s)');
    expect(findings[0].description_en).toContain('1 internal');
  });
});
