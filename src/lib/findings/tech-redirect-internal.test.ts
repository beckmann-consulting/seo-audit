import { describe, it, expect } from 'vitest';
import { generateRedirectedInternalLinkFindings } from './tech';
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

describe('generateRedirectedInternalLinkFindings — basic trigger', () => {
  it('triggers when one page links to another that has a non-trivial redirect', () => {
    const pages = [
      // Source: links to /old/
      page({
        url: 'https://example.com/about',
        finalUrl: 'https://example.com/about',
        internalLinks: ['https://example.com/old/'],
      }),
      // Target: was /old/, redirected to /new/
      page({
        url: 'https://example.com/new/',
        finalUrl: 'https://example.com/new/',
        redirectChain: ['https://example.com/old/'],
      }),
    ];
    const findings = generateRedirectedInternalLinkFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('recommended');
    expect(findings[0].title_en).toContain('1 link');
    expect(findings[0].description_en).toContain('https://example.com/about');
    expect(findings[0].description_en).toContain('https://example.com/old/');
    expect(findings[0].description_en).toContain('https://example.com/new/');
  });

  it('does NOT trigger when no internal links point to a redirect source', () => {
    const pages = [
      page({
        url: 'https://example.com/about',
        internalLinks: ['https://example.com/contact'],
      }),
      page({
        url: 'https://example.com/contact',
        finalUrl: 'https://example.com/contact',
      }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toEqual([]);
  });
});

describe('generateRedirectedInternalLinkFindings — trivial-redirect filter', () => {
  it('does NOT trigger on HTTP→HTTPS protocol-only redirect', () => {
    const pages = [
      page({
        url: 'https://example.com/about',
        internalLinks: ['http://example.com/landing'],
      }),
      page({
        url: 'https://example.com/landing',
        finalUrl: 'https://example.com/landing',
        redirectChain: ['http://example.com/landing'],
      }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toEqual([]);
  });

  it('does NOT trigger on www-vs-apex-only redirect (same path)', () => {
    const pages = [
      page({
        url: 'https://example.com/about',
        internalLinks: ['https://www.example.com/landing'],
      }),
      page({
        url: 'https://example.com/landing',
        finalUrl: 'https://example.com/landing',
        redirectChain: ['https://www.example.com/landing'],
      }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toEqual([]);
  });

  it('DOES trigger when path also changes (not trivial)', () => {
    const pages = [
      page({
        url: 'https://example.com/about',
        internalLinks: ['http://example.com/old-page/'],
      }),
      page({
        url: 'https://example.com/new-page/',
        finalUrl: 'https://example.com/new-page/',
        // Path changed AND protocol changed — overall not trivial.
        redirectChain: ['http://example.com/old-page/'],
      }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toHaveLength(1);
  });
});

describe('generateRedirectedInternalLinkFindings — cross-page aggregation', () => {
  it('counts every linker pair, not just unique targets', () => {
    const pages = [
      page({ url: 'https://example.com/a', internalLinks: ['https://example.com/old'] }),
      page({ url: 'https://example.com/b', internalLinks: ['https://example.com/old'] }),
      page({
        url: 'https://example.com/new',
        finalUrl: 'https://example.com/new',
        redirectChain: ['https://example.com/old'],
      }),
    ];
    const findings = generateRedirectedInternalLinkFindings(pages);
    expect(findings).toHaveLength(1);
    // 2 linkers (a and b) referencing 1 redirect-source
    expect(findings[0].title_en).toContain('2 link');
  });

  it('limits the description sample to top-3 unique redirect targets', () => {
    const redirectingPages = Array.from({ length: 5 }, (_, i) =>
      page({
        url: `https://example.com/new${i}`,
        finalUrl: `https://example.com/new${i}`,
        redirectChain: [`https://example.com/old${i}`],
      }),
    );
    const linker = page({
      url: 'https://example.com/hub',
      internalLinks: Array.from({ length: 5 }, (_, i) => `https://example.com/old${i}`),
    });
    const findings = generateRedirectedInternalLinkFindings([linker, ...redirectingPages]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('5 link');
    // Sample must contain old0/1/2 (in queue order) and NOT old3/old4
    expect(findings[0].description_en).toContain('old0');
    expect(findings[0].description_en).toContain('old1');
    expect(findings[0].description_en).toContain('old2');
    expect(findings[0].description_en).not.toContain('old3');
    expect(findings[0].description_en).not.toContain('old4');
  });

  it('skips self-references (a page linking to its own redirect-source)', () => {
    const pages = [
      page({
        url: 'https://example.com/new',
        finalUrl: 'https://example.com/new',
        redirectChain: ['https://example.com/old'],
        // The page itself contains a link back to its old URL — benign
        // (canonical signal, breadcrumb, back-to-top, …). Not a finding.
        internalLinks: ['https://example.com/old'],
      }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toEqual([]);
  });
});

describe('generateRedirectedInternalLinkFindings — edge cases', () => {
  it('returns [] for an empty pages array', () => {
    expect(generateRedirectedInternalLinkFindings([])).toEqual([]);
  });

  it('returns [] when no page has a non-trivial redirect', () => {
    const pages = [
      page({ url: 'https://example.com/a', internalLinks: ['https://example.com/b'] }),
      page({ url: 'https://example.com/b', finalUrl: 'https://example.com/b' }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toEqual([]);
  });

  it('matches across trailing-slash variation between internalLink and redirectChain', () => {
    const pages = [
      page({
        url: 'https://example.com/about',
        // The href as written in the HTML has no trailing slash.
        internalLinks: ['https://example.com/old'],
      }),
      page({
        url: 'https://example.com/new',
        finalUrl: 'https://example.com/new',
        // The redirect source as observed at request time has the slash.
        redirectChain: ['https://example.com/old/'],
      }),
    ];
    expect(generateRedirectedInternalLinkFindings(pages)).toHaveLength(1);
  });
});

describe('generateRedirectedInternalLinkFindings — DE/EN wording', () => {
  it('emits both German and English copy', () => {
    const pages = [
      page({
        url: 'https://example.com/about',
        internalLinks: ['https://example.com/old/'],
      }),
      page({
        url: 'https://example.com/new/',
        finalUrl: 'https://example.com/new/',
        redirectChain: ['https://example.com/old/'],
      }),
    ];
    const [f] = generateRedirectedInternalLinkFindings(pages);
    expect(f.title_de).toContain('Redirect-URLs');
    expect(f.title_en).toContain('redirect URLs');
    expect(f.recommendation_de).toMatch(/CMS|Template/);
    expect(f.recommendation_en).toMatch(/CMS|template/i);
  });
});
