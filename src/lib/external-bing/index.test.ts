import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchBingData } from './index';

afterEach(() => { vi.restoreAllMocks(); });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Helper: stub fetch to return different bodies for query- vs page-stats
// calls based on the URL substring.
function stubBingApi(opts: {
  queries?: Response;
  pages?: Response;
}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    if (url.includes('GetQueryStats')) {
      return opts.queries ?? jsonResponse({ d: [] });
    }
    if (url.includes('GetPageStats')) {
      return opts.pages ?? jsonResponse({ d: [] });
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

describe('fetchBingData — happy path', () => {
  it('returns ok=true with parsed queries + pages and computed totals', async () => {
    stubBingApi({
      queries: jsonResponse({
        d: [
          { Query: 'a', Clicks: 10, Impressions: 100, AvgImpressionPosition: 5 },
          { Query: 'b', Clicks: 5, Impressions: 50, AvgImpressionPosition: 3 },
        ],
      }),
      pages: jsonResponse({
        d: [
          { Page: 'https://example.com/x', Clicks: 7, Impressions: 70, AvgImpressionPosition: 4 },
        ],
      }),
    });

    const result = await fetchBingData('https://example.com/', 'KEY');
    if (!result.ok) throw new Error('expected ok=true, got ' + result.error);

    expect(result.data.siteUrl).toBe('https://example.com/');
    expect(result.data.topQueries).toHaveLength(2);
    expect(result.data.topPages).toHaveLength(1);

    // Totals: 15 clicks / 150 impressions → ctr 0.1
    expect(result.data.totals.clicks).toBe(15);
    expect(result.data.totals.impressions).toBe(150);
    expect(result.data.totals.ctr).toBeCloseTo(0.1);

    // Impression-weighted position: (5*100 + 3*50) / 150 = 650/150 ≈ 4.33
    expect(result.data.totals.position).toBeCloseTo(4.333, 2);
  });

  it('handles empty result lists gracefully (zero totals, no div-by-zero)', async () => {
    stubBingApi({
      queries: jsonResponse({ d: [] }),
      pages: jsonResponse({ d: [] }),
    });
    const result = await fetchBingData('https://example.com/', 'KEY');
    if (!result.ok) throw new Error('expected ok=true');
    expect(result.data.totals).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
    expect(result.data.topQueries).toEqual([]);
    expect(result.data.topPages).toEqual([]);
  });
});

describe('fetchBingData — error classification', () => {
  it('maps 401 to userError=true (api-error → state=api-error in route)', async () => {
    stubBingApi({ queries: new Response('Unauthorised', { status: 401 }) });
    const result = await fetchBingData('https://example.com/', 'badkey');
    if (result.ok) throw new Error('expected ok=false');
    expect(result.userError).toBe(true);
    expect(result.error).toMatch(/API key invalid/i);
  });

  it('maps 404 to userError=true (site-not-found path)', async () => {
    stubBingApi({ queries: new Response('Not found', { status: 404 }) });
    const result = await fetchBingData('https://wrong.example/', 'KEY');
    if (result.ok) throw new Error('expected ok=false');
    expect(result.userError).toBe(true);
    expect(result.error).toMatch(/Site not found/i);
  });

  it('maps 503 to userError=false (operator transient)', async () => {
    stubBingApi({ queries: new Response('SVC', { status: 503 }) });
    const result = await fetchBingData('https://example.com/', 'KEY');
    if (result.ok) throw new Error('expected ok=false');
    expect(result.userError).toBe(false);
  });

  it('wraps non-BingApiError throws with userError=false', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connection refused'));
    const result = await fetchBingData('https://example.com/', 'KEY');
    if (result.ok) throw new Error('expected ok=false');
    expect(result.userError).toBe(false);
    expect(result.error).toMatch(/connection refused/);
  });
});
