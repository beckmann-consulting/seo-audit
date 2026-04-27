import { describe, it, expect, vi, afterEach } from 'vitest';
import { crawlSite } from './crawler';

// Verifies that the crawler attaches the Authorization header on
// every HTTP request when basic-auth credentials are configured.

function makeHtmlResponse(body = '<html><head><title>x</title></head><body>ok</body></html>'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('crawlSite — Authorization header', () => {
  it('omits Authorization when no auth header is given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite('https://example.com/', 1);
    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('attaches the Authorization header verbatim when given', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      1,
      undefined,        // no progress callback
      'TestUA/1.0',     // userAgent
      [], [],           // includes, excludes
      'Basic YWRtaW46c2VjcmV0', // authHeader
    );
    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic YWRtaW46c2VjcmV0');
    expect(headers['User-Agent']).toBe('TestUA/1.0');
  });

  it('keeps the Authorization header on subsequent crawled pages', async () => {
    // Two pages: home links to /about
    const home = makeHtmlResponse(
      '<html><body><a href="/about">x</a></body></html>',
    );
    const about = makeHtmlResponse('<html><body>about</body></html>');
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => home)
      .mockImplementationOnce(async () => about);

    await crawlSite(
      'https://example.com/',
      2,
      undefined,
      'UA',
      [], [],
      'Basic Zm9vOmJhcg==',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Basic Zm9vOmJhcg==');
    }
  });
});

describe('crawlSite — custom headers', () => {
  it('attaches user-supplied custom headers to outbound requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      1,
      undefined,
      'UA',
      [], [],
      undefined,
      { 'Cookie': 'session=xyz', 'X-Custom': 'test' },
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Cookie']).toBe('session=xyz');
    expect(headers['X-Custom']).toBe('test');
    // Built-in UA still present (no override here)
    expect(headers['User-Agent']).toBe('UA');
  });

  it('lets a custom header override a built-in one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeHtmlResponse());
    await crawlSite(
      'https://example.com/',
      1,
      undefined,
      'OriginalUA',
      [], [],
      undefined,
      { 'User-Agent': 'OverriddenUA', 'Authorization': 'Bearer custom' },
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    // Custom value wins
    expect(headers['User-Agent']).toBe('OverriddenUA');
    expect(headers['Authorization']).toBe('Bearer custom');
  });
});
