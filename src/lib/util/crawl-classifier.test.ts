import { describe, expect, it, vi } from 'vitest';
import { classifyAfterRendererThrow } from './crawl-classifier';

const URL = 'https://example.com/page';
const REASON = 'Timeout 30000ms exceeded';
const HEADERS = { 'User-Agent': 'TestUA' };

describe('classifyAfterRendererThrow', () => {
  it('200 OK → renderFailed (URL reachable, JS render alone failed)', async () => {
    const fakeFetch = vi.fn(async () => new Response('', { status: 200 }));
    const result = await classifyAfterRendererThrow(URL, REASON, HEADERS, fakeFetch as never);
    expect(result).toEqual({ bucket: 'renderFailed', reason: REASON });
  });

  it('301 (non-followed 3xx) → renderFailed (still treat as reachable)', async () => {
    // Synthetic — fetch with redirect: 'follow' usually resolves on the
    // final 200, but some origins respond with a 3xx that has no
    // Location and the runtime surfaces it. Counted as reachable.
    const fakeFetch = vi.fn(async () => new Response('', { status: 301 }));
    const result = await classifyAfterRendererThrow(URL, REASON, HEADERS, fakeFetch as never);
    expect(result).toEqual({ bucket: 'renderFailed', reason: REASON });
  });

  it('404 → httpErrors with the real status', async () => {
    const fakeFetch = vi.fn(async () => new Response('', { status: 404 }));
    const result = await classifyAfterRendererThrow(URL, REASON, HEADERS, fakeFetch as never);
    expect(result).toEqual({ bucket: 'httpErrors', status: 404 });
  });

  it('503 → httpErrors with status 503', async () => {
    const fakeFetch = vi.fn(async () => new Response('', { status: 503 }));
    const result = await classifyAfterRendererThrow(URL, REASON, HEADERS, fakeFetch as never);
    expect(result).toEqual({ bucket: 'httpErrors', status: 503 });
  });

  it('HEAD itself fails → unreachable with the network error reason', async () => {
    const fakeFetch = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND'); });
    const result = await classifyAfterRendererThrow(URL, REASON, HEADERS, fakeFetch as never);
    expect(result).toEqual({ bucket: 'unreachable', reason: 'getaddrinfo ENOTFOUND' });
  });

  it('HEAD timeout → unreachable, originalReason discarded for accuracy', async () => {
    const fakeFetch = vi.fn(async () => { throw new Error('AbortError: signal aborted'); });
    const result = await classifyAfterRendererThrow(URL, REASON, HEADERS, fakeFetch as never);
    expect(result.bucket).toBe('unreachable');
    expect((result as { reason: string }).reason).toContain('Abort');
  });

  it('passes the supplied User-Agent + custom headers through to the probe', async () => {
    // Typed fetch stub so the test can introspect call args without
    // losing TypeScript on the destructured RequestInit.
    const calls: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return new Response('', { status: 200 });
    };
    const customHeaders = { 'User-Agent': 'SEOAuditPro/2.0', 'X-Token': 'abc' };
    await classifyAfterRendererThrow(URL, REASON, customHeaders, fakeFetch);
    expect(calls[0].input).toBe(URL);
    expect(calls[0].init?.method).toBe('HEAD');
    expect(calls[0].init?.headers).toEqual(customHeaders);
  });
});
