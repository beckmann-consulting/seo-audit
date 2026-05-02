import { describe, it, expect } from 'vitest';
import { generateLegacyImageFormatFindings, generateDeepImageFormatFindings } from './content';
import type { PageSEOData } from '@/types';

function page(url: string, imageSrcs: string[]): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: imageSrcs.length,
    internalLinks: [], externalLinks: [],
    wordCount: 500, hasCanonical: true,
    renderBlockingScripts: 0, modernImageFormats: 0, lazyLoadedImages: 0,
    hreflangs: [],
    viewportBlocksZoom: false, viewportHasInitialScale: true,
    fixedWidthElements: 0, smallFontElements: 0, legacyPlugins: 0,
    likelyClientRendered: false,
    genericAnchors: [], emptyAnchors: 0, hasNoindex: false,
    imageDetails: imageSrcs.map(src => ({
      src, hasWidth: true, hasHeight: true, isLazy: false, hasSrcset: false,
    })),
    fontPreloads: 0, hasFontDisplaySwap: false, hasExternalFonts: false,
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

// ============================================================
//  Awareness mode (Modus A)
// ============================================================

describe('generateLegacyImageFormatFindings — awareness mode', () => {
  it('triggers when 80% of raster images are legacy', () => {
    const pages = [
      page('https://example.com/', [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
        'https://example.com/d.png',
        'https://example.com/e.webp', // 1 modern of 5 → 80% legacy
      ]),
    ];
    const findings = generateLegacyImageFormatFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('recommended');
    expect(findings[0].title_en).toContain('80%');
    expect(findings[0].title_en).toContain('legacy');
  });

  it('does NOT trigger when only 50% are legacy', () => {
    const pages = [
      page('https://example.com/', [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
        'https://example.com/d.webp',
        'https://example.com/e.webp',
        'https://example.com/f.webp',
      ]),
    ];
    expect(generateLegacyImageFormatFindings(pages)).toEqual([]);
  });

  it('does NOT trigger below the minimum-total threshold', () => {
    // 3 images, all legacy, but below LEGACY_FORMAT_MIN_TOTAL=5 → no finding
    const pages = [
      page('https://example.com/', [
        'https://example.com/a.jpg',
        'https://example.com/b.png',
        'https://example.com/c.png',
      ]),
    ];
    expect(generateLegacyImageFormatFindings(pages)).toEqual([]);
  });

  it('returns [] for empty pages array (no crash)', () => {
    expect(generateLegacyImageFormatFindings([])).toEqual([]);
  });

  it('does NOT trigger on an SVG-only site (SVG already considered modern/vector)', () => {
    const pages = [
      page('https://example.com/', [
        'https://example.com/a.svg',
        'https://example.com/b.svg',
        'https://example.com/c.svg',
        'https://example.com/d.svg',
        'https://example.com/e.svg',
        'https://example.com/f.svg',
      ]),
    ];
    expect(generateLegacyImageFormatFindings(pages)).toEqual([]);
  });

  it('skips data: URIs and malformed srcs without crashing', () => {
    const pages = [
      page('https://example.com/', [
        'data:image/png;base64,iVBOR',
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
        'https://example.com/d.jpg',
        'https://example.com/e.jpg',
        'https://example.com/f.png',
      ]),
    ];
    const findings = generateLegacyImageFormatFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('100%');
  });

  it('dedupes images shared across pages', () => {
    const shared = ['https://example.com/logo.jpg'];
    const pages = [
      page('https://example.com/', [
        ...shared,
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
        'https://example.com/d.jpg',
        'https://example.com/e.webp',
      ]),
      page('https://example.com/about', shared), // same logo → not double-counted
    ];
    const findings = generateLegacyImageFormatFindings(pages);
    expect(findings).toHaveLength(1);
    // 5 legacy of 6 raster (logo not counted twice) → 83%
    expect(findings[0].title_en).toMatch(/8[3-4]%/);
  });

  it('includes top-3 largest legacy images in the description when sizes available', () => {
    const pages = [
      page('https://example.com/', [
        'https://example.com/hero.jpg',
        'https://example.com/banner.jpg',
        'https://example.com/thumb.png',
        'https://example.com/icon.png',
        'https://example.com/logo.jpg',
      ]),
    ];
    const imageSizes = [
      { url: 'https://example.com/hero.jpg', sizeBytes: 800_000 },
      { url: 'https://example.com/banner.jpg', sizeBytes: 400_000 },
      { url: 'https://example.com/thumb.png', sizeBytes: 200_000 },
      { url: 'https://example.com/icon.png', sizeBytes: 100_000 },
    ];
    const findings = generateLegacyImageFormatFindings(pages, imageSizes);
    expect(findings).toHaveLength(1);
    expect(findings[0].description_en).toContain('hero.jpg');
    expect(findings[0].description_en).toContain('banner.jpg');
    expect(findings[0].description_en).toContain('thumb.png');
    expect(findings[0].description_en).not.toContain('icon.png');
  });
});

// ============================================================
//  Deep mode (Modus B)
// ============================================================

describe('generateDeepImageFormatFindings — deep mode', () => {
  it('triggers when WebP and AVIF both fail for at least one image', () => {
    const findings = generateDeepImageFormatFindings([
      { url: 'https://example.com/a.jpg', format: 'jpg', hasWebpVariant: false, hasAvifVariant: false },
      { url: 'https://example.com/b.png', format: 'png', hasWebpVariant: true, hasAvifVariant: false },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('1 image');
    expect(findings[0].description_en).toContain('a.jpg');
    expect(findings[0].description_en).not.toContain('b.png');
  });

  it('does NOT trigger when every image has at least a WebP variant', () => {
    const findings = generateDeepImageFormatFindings([
      { url: 'https://example.com/a.jpg', format: 'jpg', hasWebpVariant: true, hasAvifVariant: false },
      { url: 'https://example.com/b.png', format: 'png', hasWebpVariant: true, hasAvifVariant: true },
    ]);
    expect(findings).toEqual([]);
  });

  it('does NOT trigger when results are undefined (deep mode disabled)', () => {
    expect(generateDeepImageFormatFindings(undefined)).toEqual([]);
  });

  it('returns [] for empty results', () => {
    expect(generateDeepImageFormatFindings([])).toEqual([]);
  });

  it('sorts the description sample by file size when imageSizes is provided', () => {
    const deep = [
      { url: 'https://example.com/small.jpg', format: 'jpg' as const, hasWebpVariant: false, hasAvifVariant: false },
      { url: 'https://example.com/huge.jpg', format: 'jpg' as const, hasWebpVariant: false, hasAvifVariant: false },
      { url: 'https://example.com/medium.jpg', format: 'jpg' as const, hasWebpVariant: false, hasAvifVariant: false },
    ];
    const sizes = [
      { url: 'https://example.com/small.jpg', sizeBytes: 50_000 },
      { url: 'https://example.com/huge.jpg', sizeBytes: 900_000 },
      { url: 'https://example.com/medium.jpg', sizeBytes: 300_000 },
    ];
    const findings = generateDeepImageFormatFindings(deep, sizes);
    expect(findings).toHaveLength(1);
    // huge appears before medium appears before small in the rendered sample
    const desc = findings[0].description_en;
    const huge = desc.indexOf('huge.jpg');
    const medium = desc.indexOf('medium.jpg');
    const small = desc.indexOf('small.jpg');
    expect(huge).toBeGreaterThanOrEqual(0);
    expect(huge).toBeLessThan(medium);
    expect(medium).toBeLessThan(small);
  });

  it('truncates the sample to top-5', () => {
    const deep = Array.from({ length: 7 }, (_, i) => ({
      url: `https://example.com/img${i}.jpg`,
      format: 'jpg' as const,
      hasWebpVariant: false,
      hasAvifVariant: false,
    }));
    const findings = generateDeepImageFormatFindings(deep);
    expect(findings).toHaveLength(1);
    expect(findings[0].title_en).toContain('7 image');
    // First 5 in description; img5 + img6 should be cut
    expect(findings[0].description_en).toContain('img0.jpg');
    expect(findings[0].description_en).toContain('img4.jpg');
    expect(findings[0].description_en).not.toContain('img5.jpg');
    expect(findings[0].description_en).not.toContain('img6.jpg');
  });
});

// ============================================================
//  DE/EN wording
// ============================================================

describe('generateLegacyImageFormatFindings — DE/EN wording', () => {
  it('emits both German and English copy', () => {
    const pages = [
      page('https://example.com/', [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
        'https://example.com/c.jpg',
        'https://example.com/d.png',
        'https://example.com/e.png',
      ]),
    ];
    const f = generateLegacyImageFormatFindings(pages)[0];
    expect(f.title_de).toContain('veralteten Format');
    expect(f.title_en).toContain('legacy formats');
    expect(f.recommendation_de).toContain('WebP');
    expect(f.recommendation_en).toContain('WebP');
  });
});

describe('generateDeepImageFormatFindings — DE/EN wording', () => {
  it('emits both German and English copy', () => {
    const f = generateDeepImageFormatFindings([
      { url: 'https://example.com/a.jpg', format: 'jpg', hasWebpVariant: false, hasAvifVariant: false },
    ])[0];
    expect(f.title_de).toContain('Bild(er) ohne moderne Format-Variante');
    expect(f.title_en).toContain('image(s) without modern format variant');
    expect(f.recommendation_de).toContain('WebP');
    expect(f.recommendation_en).toContain('WebP');
  });
});
