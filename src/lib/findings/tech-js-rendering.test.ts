import { describe, it, expect } from 'vitest';
import { generateJsRenderingFindings } from './tech';
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
    wordCount: 0, hasCanonical: true,
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

describe('generateJsRenderingFindings — noop in static mode', () => {
  it('returns nothing when no page has renderMode = js', () => {
    expect(generateJsRenderingFindings([])).toHaveLength(0);
    expect(generateJsRenderingFindings([
      page({ wordCount: 500 }), // no renderMode at all
    ])).toHaveLength(0);
    expect(generateJsRenderingFindings([
      page({ wordCount: 500, renderMode: 'static' }),
    ])).toHaveLength(0);
  });

  it('skips JS-mode pages where staticWordCount was never captured', () => {
    expect(generateJsRenderingFindings([
      page({ renderMode: 'js', wordCount: 500 }), // no staticWordCount
    ])).toHaveLength(0);
  });
});

describe('generateJsRenderingFindings — js-rendering-required', () => {
  it('flags Critical when static is near-empty but rendered is rich', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://x.com/spa',
        renderMode: 'js',
        wordCount: 800,         // post-render content
        staticWordCount: 5,     // empty SPA shell
      }),
    ]);
    const f = findings.find(x => x.title_en.includes('rendering required'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('critical');
    expect(f!.description_en).toContain('static 5 → rendered 800');
  });

  it('flags Important when content roughly doubles after JS', () => {
    const findings = generateJsRenderingFindings([
      page({
        renderMode: 'js',
        wordCount: 600,
        staticWordCount: 250, // 2.4× — meets the 2× threshold
      }),
    ]);
    const f = findings.find(x => x.title_en.includes('rendering required'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('important');
  });

  it('does NOT fire when rendered content is below 100 words', () => {
    expect(generateJsRenderingFindings([
      page({ renderMode: 'js', wordCount: 80, staticWordCount: 5 }),
    ])).toHaveLength(0);
  });

  it('does NOT fire when static and rendered are roughly the same', () => {
    expect(generateJsRenderingFindings([
      page({ renderMode: 'js', wordCount: 500, staticWordCount: 480 }),
    ])).toHaveLength(0);
  });

  it('escalates to Critical when ANY page in the cluster meets the Critical threshold', () => {
    const findings = generateJsRenderingFindings([
      page({ url: 'https://x.com/a', renderMode: 'js', wordCount: 300, staticWordCount: 100 }), // important
      page({ url: 'https://x.com/b', renderMode: 'js', wordCount: 800, staticWordCount: 5 }),    // critical
    ]);
    const f = findings.find(x => x.title_en.includes('rendering required'));
    expect(f!.priority).toBe('critical');
    expect(f!.title_en).toContain('2 page');
  });

  it('caps the URL sample at 5', () => {
    const pages = Array.from({ length: 12 }, (_, i) => page({
      url: `https://x.com/${i}`,
      renderMode: 'js',
      wordCount: 800,
      staticWordCount: 5,
    }));
    const findings = generateJsRenderingFindings(pages);
    const f = findings.find(x => x.title_en.includes('rendering required'))!;
    const examples = f.description_en.match(/https:\/\/x\.com\/\d/g) || [];
    expect(examples.length).toBe(5);
  });
});

describe('generateJsRenderingFindings — js-console-errors', () => {
  it('flags pages that emitted at least one console error', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://x.com/broken',
        renderMode: 'js',
        wordCount: 50, staticWordCount: 50,
        consoleErrors: ['TypeError: foo is null'],
      }),
    ]);
    const f = findings.find(x => x.title_en.includes('JavaScript errors'));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('recommended');
    expect(f!.description_en).toContain('TypeError');
  });

  it('aggregates total error count across pages', () => {
    const findings = generateJsRenderingFindings([
      page({ url: 'https://x.com/a', renderMode: 'js', wordCount: 50, staticWordCount: 50,
             consoleErrors: ['e1', 'e2'] }),
      page({ url: 'https://x.com/b', renderMode: 'js', wordCount: 50, staticWordCount: 50,
             consoleErrors: ['e3'] }),
      page({ url: 'https://x.com/c', renderMode: 'js', wordCount: 50, staticWordCount: 50,
             consoleErrors: [] }), // no errors
    ]);
    const f = findings.find(x => x.title_en.includes('JavaScript errors'))!;
    expect(f.title_en).toContain('2 page');
    expect(f.title_en).toContain('3 total');
  });

  it('truncates very long error messages in the sample', () => {
    const long = 'x'.repeat(500);
    const findings = generateJsRenderingFindings([
      page({ url: 'https://x.com/a', renderMode: 'js', wordCount: 50, staticWordCount: 50,
             consoleErrors: [long] }),
    ]);
    const f = findings.find(x => x.title_en.includes('JavaScript errors'))!;
    expect(f.description_en).toContain('…');
    // The truncated snippet shouldn't be the full 500-char string
    expect(f.description_en).not.toContain('x'.repeat(500));
  });
});

describe('both findings can co-emit on the same page', () => {
  it('a page that needs JS AND has errors triggers both findings', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://x.com/spa',
        renderMode: 'js',
        wordCount: 800, staticWordCount: 5,
        consoleErrors: ['Hydration mismatch'],
      }),
    ]);
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.priority).sort()).toEqual(['critical', 'recommended']);
  });
});
