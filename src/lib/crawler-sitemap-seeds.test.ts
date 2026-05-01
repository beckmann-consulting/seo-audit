import { describe, it, expect, vi, afterEach } from 'vitest';
import { crawlSite } from './crawler';

// A9.2 — seedUrls parameter feeds sitemap-discovered URLs into the
// crawler queue alongside the start URL. Tests verify that:
//   1. valid same-origin seeds get crawled
//   2. seeds on different domains are filtered out (origin guard)
//   3. www-prefixed seeds against an apex start URL pass (A9.1 reuse)
//   4. malformed seed URLs are skipped without throwing
//   5. omitting the parameter behaves identically to the pre-A9.2 API

function makeHtmlResponse(body = '<html><head><title>x</title></head><body>seed-ok</body></html>'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crawlSite — seedUrls (A9.2)', () => {
  it('crawls all same-origin seed URLs in addition to the start URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      0,                                              // unlimited
      undefined, undefined, undefined, undefined,     // progress, UA, includes, excludes
      undefined, undefined, undefined,                // auth, headers, renderer
      [
        'https://example.com/de/page-a',
        'https://example.com/en/page-b',
        'https://example.com/legal/privacy',
      ],
    );
    const fetchedUrls = fetchSpy.mock.calls.map(c => c[0] as string);
    expect(fetchedUrls).toContain('https://example.com/');
    expect(fetchedUrls).toContain('https://example.com/de/page-a');
    expect(fetchedUrls).toContain('https://example.com/en/page-b');
    expect(fetchedUrls).toContain('https://example.com/legal/privacy');
  });

  it('filters out seeds on a different origin', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      0,
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      [
        'https://example.com/de/page-a',
        'https://other.com/external',  // ← different domain, must be skipped
        'https://example.com/legal',
      ],
    );
    const fetchedUrls = fetchSpy.mock.calls.map(c => c[0] as string);
    expect(fetchedUrls).toContain('https://example.com/de/page-a');
    expect(fetchedUrls).toContain('https://example.com/legal');
    expect(fetchedUrls).not.toContain('https://other.com/external');
  });

  it('accepts www-prefixed seeds when the start URL is on the apex (A9.1 reuse)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      0,
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      [
        'https://www.example.com/de/page-a',
        'https://example.com/legal',
        'https://www.example.com/imprint',
      ],
    );
    const fetchedUrls = fetchSpy.mock.calls.map(c => c[0] as string);
    expect(fetchedUrls).toContain('https://www.example.com/de/page-a');
    expect(fetchedUrls).toContain('https://www.example.com/imprint');
  });

  it('skips malformed seed URLs without throwing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await expect(crawlSite(
      'https://example.com/',
      0,
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      [
        'https://example.com/valid',
        'not a url at all',           // ← malformed
        '://broken',                  // ← malformed
        'https://example.com/also-valid',
      ],
    )).resolves.toBeDefined();
    const fetchedUrls = fetchSpy.mock.calls.map(c => c[0] as string);
    expect(fetchedUrls).toContain('https://example.com/valid');
    expect(fetchedUrls).toContain('https://example.com/also-valid');
  });

  it('omitting seedUrls behaves identically to the pre-A9.2 API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite('https://example.com/', 0);
    const fetchedUrls = fetchSpy.mock.calls.map(c => c[0] as string);
    // Only the start URL is fetched (the response has no internal links)
    expect(fetchedUrls).toEqual(['https://example.com/']);
  });

  it('an empty seedUrls array also behaves like no-seeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      0,
      undefined, undefined, undefined, undefined,
      undefined, undefined, undefined,
      [],
    );
    const fetchedUrls = fetchSpy.mock.calls.map(c => c[0] as string);
    expect(fetchedUrls).toEqual(['https://example.com/']);
  });
});
