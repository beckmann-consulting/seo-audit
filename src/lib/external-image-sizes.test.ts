import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkImageSizes } from './external-image-sizes';
import type { PageSEOData } from '@/types';

function pageWithImages(url: string, srcs: string[]): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: srcs.length,
    internalLinks: [], externalLinks: [],
    wordCount: 100, hasCanonical: true,
    renderBlockingScripts: 0, modernImageFormats: 0, lazyLoadedImages: 0,
    hreflangs: [],
    viewportBlocksZoom: false, viewportHasInitialScale: true,
    fixedWidthElements: 0, smallFontElements: 0, legacyPlugins: 0,
    likelyClientRendered: false,
    genericAnchors: [], emptyAnchors: 0, hasNoindex: false,
    imageDetails: srcs.map(src => ({ src, hasWidth: true, hasHeight: true, isLazy: false, hasSrcset: false })),
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

function makeHeadResponse(sizeBytes: number, contentType = 'image/jpeg'): Response {
  return new Response(null, {
    status: 200,
    headers: { 'content-length': String(sizeBytes), 'content-type': contentType },
  });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('checkImageSizes', () => {
  it('returns [] when limit is 0', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await checkImageSizes([pageWithImages('https://x.com/', ['/a.jpg'])], 0);
    expect(r).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns [] when no pages', async () => {
    const r = await checkImageSizes([], 20);
    expect(r).toEqual([]);
  });

  it('uses HEAD method', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHeadResponse(50000));
    await checkImageSizes([pageWithImages('https://x.com/', ['/a.jpg'])], 5);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('HEAD');
  });

  it('resolves relative srcs against the page URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHeadResponse(50000));
    await checkImageSizes([pageWithImages('https://x.com/blog/post', ['hero.jpg'])], 5);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://x.com/blog/hero.jpg');
  });

  it('skips data: URIs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await checkImageSizes([pageWithImages('https://x.com/', ['data:image/png;base64,iVBORw0KG'])], 5);
    expect(r).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips non-http(s) schemes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const r = await checkImageSizes([pageWithImages('https://x.com/', ['ftp://x.com/a.jpg', 'javascript:void(0)'])], 5);
    expect(r).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('deduplicates URLs across pages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHeadResponse(10000));
    await checkImageSizes([
      pageWithImages('https://x.com/a', ['/logo.png']),
      pageWithImages('https://x.com/b', ['/logo.png']),
      pageWithImages('https://x.com/c', ['/logo.png']),
    ], 20);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('caps probes at the limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHeadResponse(10000));
    const srcs = Array.from({ length: 50 }, (_, i) => `/img-${i}.jpg`);
    await checkImageSizes([pageWithImages('https://x.com/', srcs)], 5);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('captures content-length and content-type when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHeadResponse(123456, 'image/webp'));
    const r = await checkImageSizes([pageWithImages('https://x.com/', ['/a.webp'])], 5);
    expect(r).toEqual([{ url: 'https://x.com/a.webp', sizeBytes: 123456, contentType: 'image/webp' }]);
  });

  it('drops responses without content-length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const r = await checkImageSizes([pageWithImages('https://x.com/', ['/a.jpg'])], 5);
    expect(r).toEqual([]);
  });

  it('drops failing probes silently (no throw)', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeHeadResponse(20000))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(makeHeadResponse(80000));
    const r = await checkImageSizes([
      pageWithImages('https://x.com/', ['/a.jpg', '/b.jpg', '/c.jpg']),
    ], 5);
    expect(r.map(x => x.sizeBytes).sort()).toEqual([20000, 80000]);
  });

  it('attaches user-supplied headers (UA + auth + custom)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHeadResponse(10000));
    await checkImageSizes(
      [pageWithImages('https://x.com/', ['/a.jpg'])],
      5,
      'TestUA',
      'Basic abc',
      { 'X-Custom': 'tag' },
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('TestUA');
    expect(headers['Authorization']).toBe('Basic abc');
    expect(headers['X-Custom']).toBe('tag');
  });
});
