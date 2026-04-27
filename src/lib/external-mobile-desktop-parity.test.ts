import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkMobileDesktopParity } from './external-mobile-desktop-parity';
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

// Build an async factory for an HTML response whose visible word count
// we can predict. Each `word` arg becomes a token > 2 chars (extractor
// word-count rule). We return a factory because Response bodies can
// only be consumed once — vi.mockResolvedValue would hand back the
// same already-drained body on the second call.
function htmlWithWords(...words: string[]): () => Promise<Response> {
  const body = words.join(' ');
  return async () => new Response(`<html><body><p>${body}</p></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('checkMobileDesktopParity', () => {
  it('returns [] when limit is 0', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await checkMobileDesktopParity([pageAt('https://x.com/', 0)], 0);
    expect(r).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] when no pages', async () => {
    expect(await checkMobileDesktopParity([], 5)).toEqual([]);
  });

  it('runs both Googlebot Mobile and Desktop UAs against each sampled URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(htmlWithWords('alpha', 'beta', 'gamma'));
    await checkMobileDesktopParity([pageAt('https://x.com/', 0)], 5);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const uaList = fetchSpy.mock.calls.map(c => {
      const init = c[1] as RequestInit;
      return (init.headers as Record<string, string>)['User-Agent'];
    });
    expect(uaList.some(ua => ua.includes('Mobile'))).toBe(true);
    expect(uaList.some(ua => ua.includes('Googlebot') && !ua.includes('Mobile'))).toBe(true);
  });

  it('computes a symmetric diff ratio when sides disagree', async () => {
    // Simulate: mobile shows 3 words, desktop shows 6 → diff = 3/6 = 0.5
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        const ua = (init as RequestInit).headers as Record<string, string>;
        if (ua['User-Agent'].includes('Mobile')) {
          return htmlWithWords('alpha', 'beta', 'gamma')();
        }
        return htmlWithWords('alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta')();
      });

    const r = await checkMobileDesktopParity([pageAt('https://x.com/', 0)], 1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r).toHaveLength(1);
    expect(r[0].mobileWords).toBe(3);
    expect(r[0].desktopWords).toBe(6);
    expect(r[0].diffRatio).toBeCloseTo(0.5, 2);
  });

  it('returns 0 diffRatio when both sides match', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(htmlWithWords('alpha', 'beta', 'gamma'));
    const r = await checkMobileDesktopParity([pageAt('https://x.com/', 0)], 1);
    expect(r[0].diffRatio).toBe(0);
  });

  it('samples by lowest depth first and respects the limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(htmlWithWords('alpha', 'beta'));
    const pages = [
      pageAt('https://x.com/deep-1', 5),
      pageAt('https://x.com/home', 0),
      pageAt('https://x.com/deep-2', 4),
      pageAt('https://x.com/about', 1),
    ];
    const r = await checkMobileDesktopParity(pages, 2);
    expect(r).toHaveLength(2);
    // Two fetched URLs × 2 UAs = 4 calls
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // Lowest-depth pages should have been picked
    const fetchedUrls = new Set(fetchSpy.mock.calls.map(c => c[0]));
    expect(fetchedUrls.has('https://x.com/home')).toBe(true);
    expect(fetchedUrls.has('https://x.com/about')).toBe(true);
    expect(fetchedUrls.has('https://x.com/deep-1')).toBe(false);
  });

  it('drops a page when one of the two probes fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(htmlWithWords('a', 'b', 'cat')) // mobile ok
      .mockRejectedValueOnce(new Error('timeout'));            // desktop fails
    const r = await checkMobileDesktopParity([pageAt('https://x.com/', 0)], 1);
    expect(r).toHaveLength(0);
  });

  it('skips non-HTML responses (e.g. server returned a 200 with image/png)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('binary', { status: 200, headers: { 'content-type': 'image/png' } }),
    );
    const r = await checkMobileDesktopParity([pageAt('https://x.com/', 0)], 1);
    expect(r).toHaveLength(0);
  });

  it('threads auth + custom headers into the fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(htmlWithWords('a', 'b', 'cat'));
    await checkMobileDesktopParity(
      [pageAt('https://x.com/', 0)], 1,
      'Basic xxx',
      { 'X-Bypass': 'token' },
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic xxx');
    expect(headers['X-Bypass']).toBe('token');
  });
});
