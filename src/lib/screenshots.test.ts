import { describe, it, expect, vi } from 'vitest';
import { captureScreenshotsForAudit, SCREENSHOT_VIEWPORTS } from './screenshots';
import type { JsRenderer } from './renderer';
import type { PageSEOData } from '@/types';

function pageAt(url: string, depth: number): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth,
    redirectChain: [], finalUrl: url,
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
  };
}

// Lightweight stub for JsRenderer — only the captureScreenshot
// surface matters here. We don't run a real Browserless connection.
function makeStubRenderer(impl: (url: string, viewport: { width: number; height: number }) => Promise<string | undefined>) {
  return {
    captureScreenshot: vi.fn(impl),
  } as unknown as JsRenderer & { captureScreenshot: ReturnType<typeof vi.fn> };
}

describe('captureScreenshotsForAudit', () => {
  it('returns [] when limit is 0', async () => {
    const r = makeStubRenderer(async () => 'b64');
    const result = await captureScreenshotsForAudit(r, [pageAt('https://x.com/', 0)], 0);
    expect(result).toEqual([]);
    expect(r.captureScreenshot).not.toHaveBeenCalled();
  });

  it('returns [] when no pages', async () => {
    const r = makeStubRenderer(async () => 'b64');
    expect(await captureScreenshotsForAudit(r, [], 4)).toEqual([]);
  });

  it('captures both viewports per page', async () => {
    const r = makeStubRenderer(async () => 'b64data');
    const result = await captureScreenshotsForAudit(r, [pageAt('https://x.com/', 0)], 1);
    expect(r.captureScreenshot).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].mobileBase64).toBe('b64data');
    expect(result[0].desktopBase64).toBe('b64data');
  });

  it('uses the documented viewport dimensions', async () => {
    const r = makeStubRenderer(async () => 'b64');
    await captureScreenshotsForAudit(r, [pageAt('https://x.com/', 0)], 1);
    const calls = r.captureScreenshot.mock.calls.map(c => c[1]);
    expect(calls).toContainEqual(SCREENSHOT_VIEWPORTS.mobile);
    expect(calls).toContainEqual(SCREENSHOT_VIEWPORTS.desktop);
  });

  it('samples top-N pages by lowest depth (homepage first)', async () => {
    const r = makeStubRenderer(async () => 'b64');
    const pages = [
      pageAt('https://x.com/deep-1', 5),
      pageAt('https://x.com/home', 0),
      pageAt('https://x.com/deep-2', 4),
      pageAt('https://x.com/about', 1),
      pageAt('https://x.com/contact', 2),
    ];
    const result = await captureScreenshotsForAudit(r, pages, 3);
    expect(result.map(s => s.url)).toEqual([
      'https://x.com/home',
      'https://x.com/about',
      'https://x.com/contact',
    ]);
  });

  it('skips a page when both viewports failed', async () => {
    const r = makeStubRenderer(async () => undefined); // every probe fails
    const result = await captureScreenshotsForAudit(r, [pageAt('https://x.com/', 0)], 1);
    expect(result).toHaveLength(0);
  });

  it('keeps a page when only one viewport succeeded', async () => {
    const r = makeStubRenderer(async (_url, viewport) => {
      // Mobile fails, desktop succeeds
      return viewport.width === SCREENSHOT_VIEWPORTS.desktop.width ? 'desktop-b64' : undefined;
    });
    const result = await captureScreenshotsForAudit(r, [pageAt('https://x.com/', 0)], 1);
    expect(result).toHaveLength(1);
    expect(result[0].mobileBase64).toBeUndefined();
    expect(result[0].desktopBase64).toBe('desktop-b64');
  });

  it('defaults to 4 pages when limit is omitted', async () => {
    const r = makeStubRenderer(async () => 'b64');
    const pages = Array.from({ length: 10 }, (_, i) => pageAt(`https://x.com/${i}`, i));
    const result = await captureScreenshotsForAudit(r, pages);
    expect(result).toHaveLength(4);
  });
});
