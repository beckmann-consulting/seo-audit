import { describe, it, expect } from 'vitest';
import { generateXRobotsFindings } from './seo';
import type { PageSEOData } from '@/types';

// Build a PageSEOData with sane defaults; test cases override only the
// X-Robots-related fields plus url/depth/hasNoindex.
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
    ...partial,
  };
}

// Reset the shared finding-id counter between tests would be nice, but
// the id is opaque to the assertions — we match on title strings instead.

describe('generateXRobotsFindings', () => {
  it('returns no findings when no header is present anywhere', () => {
    expect(generateXRobotsFindings([page({})])).toHaveLength(0);
  });

  it('flags a generic noindex header (Important, not Critical, when not on homepage)', () => {
    // hasNoindex=true to align meta with header → no conflict finding
    const findings = generateXRobotsFindings([
      page({ url: 'https://example.com/', depth: 0 }),
      page({
        url: 'https://example.com/secret', depth: 1,
        xRobotsTag: 'noindex', xRobotsNoindex: true, hasNoindex: true,
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('important');
    expect(findings[0].title_de).toContain('1 Seite');
    expect(findings[0].affectedUrl).toBe('https://example.com/secret');
  });

  it('escalates to Critical when the homepage carries the noindex header', () => {
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/', depth: 0,
        xRobotsTag: 'noindex', xRobotsNoindex: true, hasNoindex: true,
      }),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('critical');
  });

  it('flags a bot-specific googlebot noindex as noindexed AND as bot-specific', () => {
    // hasNoindex=true to suppress the conflict finding for this test
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/x', depth: 1,
        xRobotsTag: 'googlebot: noindex',
        xRobotsNoindex: true,
        hasNoindex: true,
        xRobotsBotSpecific: [{ bot: 'googlebot', directives: ['noindex'] }],
      }),
    ]);
    // noindex (Important) + bot-specific (Optional)
    expect(findings.map(f => f.priority).sort()).toEqual(['important', 'optional']);
  });

  it('flags a header/meta conflict (header excludes, meta does not)', () => {
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/p', depth: 1,
        hasNoindex: false,
        xRobotsTag: 'noindex',
        xRobotsNoindex: true,
      }),
    ]);
    const titles = findings.map(f => f.title_en).join(' | ');
    expect(titles).toContain('Conflicting indexability signals');
  });

  it('flags a header/meta conflict (meta excludes, header is set but not noindex)', () => {
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/p', depth: 1,
        hasNoindex: true,
        xRobotsTag: 'max-snippet: 50',
        xRobotsNoindex: false,
      }),
    ]);
    const titles = findings.map(f => f.title_en).join(' | ');
    expect(titles).toContain('Conflicting indexability signals');
  });

  it('does NOT flag a conflict when meta and header agree on noindex', () => {
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/p', depth: 1,
        hasNoindex: true,
        xRobotsTag: 'noindex',
        xRobotsNoindex: true,
      }),
    ]);
    const titles = findings.map(f => f.title_en).join(' | ');
    expect(titles).not.toContain('Conflicting indexability signals');
  });

  it('emits the bot-specific Optional finding only when bot-prefixed directives exist', () => {
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/a', depth: 1,
        xRobotsTag: 'googlebot: noindex, bingbot: nofollow',
        xRobotsNoindex: true,
        xRobotsBotSpecific: [
          { bot: 'googlebot', directives: ['noindex'] },
          { bot: 'bingbot', directives: ['nofollow'] },
        ],
      }),
    ]);
    const optional = findings.find(f => f.priority === 'optional');
    expect(optional).toBeDefined();
    expect(optional!.title_en).toContain('googlebot');
    expect(optional!.title_en).toContain('bingbot');
  });

  it('handles an empty page list', () => {
    expect(generateXRobotsFindings([])).toHaveLength(0);
  });

  it('emits BOTH noindex and conflict findings when header noindexes but meta does not', () => {
    const findings = generateXRobotsFindings([
      page({
        url: 'https://example.com/p', depth: 1,
        xRobotsTag: 'noindex', xRobotsNoindex: true,
        hasNoindex: false,
      }),
    ]);
    const titles = findings.map(f => f.title_en);
    expect(titles.some(t => t.startsWith('X-Robots-Tag sets noindex'))).toBe(true);
    expect(titles.some(t => t === 'Conflicting indexability signals on 1 page(s)')).toBe(true);
  });
});

// Counter isolation: each test above creates fresh PageSEOData but the
// finding id() counter lives at module scope. The tests assert on title /
// priority / affectedUrl rather than id — so cross-test counter drift
// doesn't cause flakes. Keep that invariant if extending.
