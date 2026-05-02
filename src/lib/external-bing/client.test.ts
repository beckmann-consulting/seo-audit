import { describe, it, expect, vi, afterEach } from 'vitest';
import { BingApiError, getQueryStats, getPageStats } from './client';

afterEach(() => { vi.restoreAllMocks(); });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('getQueryStats', () => {
  it('parses Bing rows and computes CTR', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      d: [
        { Query: 'seo audit', Clicks: 10, Impressions: 200, AvgImpressionPosition: 5.4 },
        { Query: 'how to seo', Clicks: 5, Impressions: 100, AvgImpressionPosition: 3.2 },
      ],
    }));
    const rows = await getQueryStats('KEY', 'https://example.com/');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      query: 'seo audit',
      page: undefined,
      clicks: 10,
      impressions: 200,
      ctr: 0.05,
      position: 5.4,
    });
    expect(rows[1].ctr).toBeCloseTo(0.05);
  });

  it('guards against div-by-zero when impressions is 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      d: [{ Query: 'noimps', Clicks: 0, Impressions: 0, AvgImpressionPosition: 0 }],
    }));
    const [row] = await getQueryStats('KEY', 'https://example.com/');
    expect(row.ctr).toBe(0);
    expect(Number.isFinite(row.ctr)).toBe(true);
  });

  it('passes the apikey + siteUrl as query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ d: [] }));
    await getQueryStats('SECRET', 'https://example.com/');
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('apikey=SECRET');
    expect(calledUrl).toContain('siteUrl=https%3A%2F%2Fexample.com%2F');
  });

  it('honours the baseUrl test seam', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ d: [] }));
    await getQueryStats('KEY', 'https://example.com/', { baseUrl: 'http://stub.local/api' });
    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toContain('http://stub.local/api/GetQueryStats');
  });
});

describe('getPageStats', () => {
  it('parses page-stats rows with the Page key', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      d: [
        { Page: 'https://example.com/foo', Clicks: 8, Impressions: 80, AvgImpressionPosition: 6.1 },
      ],
    }));
    const [row] = await getPageStats('KEY', 'https://example.com/');
    expect(row.page).toBe('https://example.com/foo');
    expect(row.query).toBeUndefined();
    expect(row.ctr).toBeCloseTo(0.1);
  });
});

describe('BingApiError classification', () => {
  it('maps 401 → userError=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorised', { status: 401 }));
    await expect(getQueryStats('badkey', 'https://example.com/')).rejects.toMatchObject({
      name: 'BingApiError',
      status: 401,
      userError: true,
    });
  });

  it('maps 404 → userError=true (site not in account)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not found', { status: 404 }));
    await expect(getPageStats('KEY', 'https://example.com/')).rejects.toMatchObject({
      status: 404,
      userError: true,
    });
  });

  it('maps 503 → userError=false (operator-side transient)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('SVC', { status: 503 }));
    await expect(getQueryStats('KEY', 'https://example.com/')).rejects.toMatchObject({
      status: 503,
      userError: false,
    });
  });

  it('throws when the response is JSON but missing the "d" array', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'no rows' }));
    await expect(getQueryStats('KEY', 'https://example.com/')).rejects.toBeInstanceOf(BingApiError);
  });
});

describe('Bing in-body ErrorCode envelope', () => {
  it('maps top-level ErrorCode 14 NotAuthorized → userError=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ErrorCode: 14,
      Message: 'NotAuthorized',
    }));
    await expect(getQueryStats('KEY', 'https://unverified.example/')).rejects.toMatchObject({
      name: 'BingApiError',
      userError: true,
      errorCode: 14,
    });
  });

  it('maps wrapped d.ErrorCode 14 NotAuthorized → userError=true', async () => {
    // Some BWT endpoints return the error wrapped inside the `d`
    // envelope — must classify the same way as the top-level form.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      d: { ErrorCode: 14, Message: 'NotAuthorized' },
    }));
    await expect(getPageStats('KEY', 'https://unverified.example/')).rejects.toMatchObject({
      userError: true,
      errorCode: 14,
    });
  });

  it('maps ErrorCode 1 (InvalidApiKey) → userError=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ErrorCode: 1,
      Message: 'InvalidApiKey',
    }));
    await expect(getQueryStats('badkey', 'https://example.com/')).rejects.toMatchObject({
      userError: true,
      errorCode: 1,
    });
  });

  it('keeps ErrorCode 9 (InternalError) as userError=false', async () => {
    // Operator-side transient — should still trigger the retry hint
    // in the UI, not the site-not-found path.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ErrorCode: 9,
      Message: 'InternalError',
    }));
    await expect(getPageStats('KEY', 'https://example.com/')).rejects.toMatchObject({
      userError: false,
      errorCode: 9,
    });
  });
});
