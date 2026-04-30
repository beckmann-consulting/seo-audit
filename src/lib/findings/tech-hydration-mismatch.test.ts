import { describe, it, expect } from 'vitest';
import { generateJsRenderingFindings } from './tech';
import type { PageSEOData, StaticVsRenderedDiff } from '@/types';

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
    staticWordCount: 200,
    ...partial,
  };
}

const diff = (overrides: Partial<StaticVsRenderedDiff>): StaticVsRenderedDiff => ({
  wordCountStatic: 100,
  wordCountRendered: 100,
  wordCountDelta: 0,
  wordCountDeltaRatio: 0,
  linkCountStatic: 30,
  linkCountRendered: 30,
  linkCountDelta: 0,
  ...overrides,
});

function hydrationFinding(findings: ReturnType<typeof generateJsRenderingFindings>) {
  return findings.find(f => f.title_en.toLowerCase().includes('hydration mismatch'));
}

describe('hydration-mismatch-suspected — word-loss trigger', () => {
  it('triggers when rendered has ≥30% fewer words than static (-0.30 ratio)', () => {
    const findings = generateJsRenderingFindings([
      page({
        url: 'https://example.com/lossy',
        staticVsRenderedDiff: diff({
          wordCountStatic: 100,
          wordCountRendered: 60,
          wordCountDelta: -40,
          wordCountDeltaRatio: -0.40,
        }),
      }),
    ]);
    const f = hydrationFinding(findings);
    expect(f).toBeDefined();
    expect(f!.priority).toBe('recommended');
    expect(f!.title_en).toContain('1 page');
  });

  it('does NOT trigger on a smaller word-loss (-0.20)', () => {
    const findings = generateJsRenderingFindings([
      page({
        staticVsRenderedDiff: diff({
          wordCountStatic: 100,
          wordCountRendered: 80,
          wordCountDelta: -20,
          wordCountDeltaRatio: -0.20,
        }),
      }),
    ]);
    expect(hydrationFinding(findings)).toBeUndefined();
  });

  it('does NOT trigger when content is gained (positive ratio)', () => {
    const findings = generateJsRenderingFindings([
      page({
        staticVsRenderedDiff: diff({
          wordCountStatic: 50,
          wordCountRendered: 200,
          wordCountDelta: 150,
          wordCountDeltaRatio: 3,
        }),
      }),
    ]);
    expect(hydrationFinding(findings)).toBeUndefined();
  });
});

describe('hydration-mismatch-suspected — link-loss trigger', () => {
  it('triggers when ≥10 links lost AND staticLinkCount > 20', () => {
    const findings = generateJsRenderingFindings([
      page({
        staticVsRenderedDiff: diff({
          linkCountStatic: 30,
          linkCountRendered: 15,
          linkCountDelta: -15,
        }),
      }),
    ]);
    expect(hydrationFinding(findings)).toBeDefined();
  });

  it('does NOT trigger on -10 link-delta with too small staticLinkCount (≤20)', () => {
    const findings = generateJsRenderingFindings([
      page({
        staticVsRenderedDiff: diff({
          linkCountStatic: 15,
          linkCountRendered: 4,
          linkCountDelta: -11,
        }),
      }),
    ]);
    expect(hydrationFinding(findings)).toBeUndefined();
  });

  it('does NOT trigger on small link-delta (only -5)', () => {
    const findings = generateJsRenderingFindings([
      page({
        staticVsRenderedDiff: diff({
          linkCountStatic: 30,
          linkCountRendered: 25,
          linkCountDelta: -5,
        }),
      }),
    ]);
    expect(hydrationFinding(findings)).toBeUndefined();
  });
});

describe('hydration-mismatch-suspected — gating', () => {
  it('does NOT trigger when staticVsRenderedDiff is undefined (static-only or non-escalated auto)', () => {
    const findings = generateJsRenderingFindings([
      page({ url: 'https://example.com/x' }),
    ]);
    expect(hydrationFinding(findings)).toBeUndefined();
  });

  it('does not run on pages with renderMode !== js', () => {
    const findings = generateJsRenderingFindings([
      page({
        renderMode: 'static',
        staticWordCount: undefined,
        staticVsRenderedDiff: diff({
          wordCountStatic: 100, wordCountRendered: 50,
          wordCountDelta: -50, wordCountDeltaRatio: -0.5,
        }),
      }),
    ]);
    expect(hydrationFinding(findings)).toBeUndefined();
  });
});

describe('hydration-mismatch-suspected — site-aggregation + sample ordering', () => {
  it('produces ONE finding for many flagged pages', () => {
    const pages = Array.from({ length: 6 }, (_, i) => page({
      url: `https://example.com/p${i}`,
      staticVsRenderedDiff: diff({
        wordCountStatic: 100,
        wordCountRendered: 60 - i,
        wordCountDelta: -40 - i,
        wordCountDeltaRatio: -(0.4 + i * 0.01),
      }),
    }));
    const findings = generateJsRenderingFindings(pages);
    const matching = findings.filter(f => f.title_en.toLowerCase().includes('hydration mismatch'));
    expect(matching).toHaveLength(1);
    expect(matching[0].title_en).toContain('6 page');
  });

  it('sample is sorted by wordCountDeltaRatio asc (worst first)', () => {
    const pages = [
      page({
        url: 'https://example.com/light',
        staticVsRenderedDiff: diff({
          wordCountStatic: 100, wordCountRendered: 65,
          wordCountDelta: -35, wordCountDeltaRatio: -0.35,
        }),
      }),
      page({
        url: 'https://example.com/devastating',
        staticVsRenderedDiff: diff({
          wordCountStatic: 100, wordCountRendered: 5,
          wordCountDelta: -95, wordCountDeltaRatio: -0.95,
        }),
      }),
    ];
    const findings = generateJsRenderingFindings(pages);
    const f = hydrationFinding(findings);
    expect(f!.affectedUrl).toBe('https://example.com/devastating');
  });
});
