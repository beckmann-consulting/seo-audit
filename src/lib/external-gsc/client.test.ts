import { describe, it, expect, vi, afterEach } from 'vitest';
import { listSites, querySearchAnalytics, GscApiError } from './client';

afterEach(() => { vi.restoreAllMocks(); });

describe('listSites', () => {
  it('GETs /sites with the bearer token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const sites = await listSites('access-token-1');
    expect(sites).toEqual([{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }]);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/webmasters/v3/sites');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token-1');
  });

  it('returns [] when the response has no siteEntry field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await listSites('t')).toEqual([]);
  });

  it('throws GscApiError on non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    await expect(listSites('t')).rejects.toThrow(GscApiError);
    await expect(listSites('t')).rejects.toThrow(/401/);
  });
});

describe('querySearchAnalytics', () => {
  it('POSTs the query body with the bearer token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ rows: [{ keys: ['q1'], clicks: 10, impressions: 100, ctr: 0.1, position: 5.5 }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    const rows = await querySearchAnalytics('access-token', 'sc-domain:example.com', {
      startDate: '2026-01-01', endDate: '2026-01-28', dimensions: ['query'], rowLimit: 50,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].clicks).toBe(10);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/sites/sc-domain%3Aexample.com/searchAnalytics/query');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
    const body = JSON.parse(String(init?.body));
    expect(body.startDate).toBe('2026-01-01');
    expect(body.dimensions).toEqual(['query']);
  });

  it('URL-encodes sc-domain: properties in the path', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ rows: [] }), { status: 200 }),
    );
    await querySearchAnalytics('t', 'sc-domain:foo.com', { startDate: 'x', endDate: 'y' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('sc-domain%3Afoo.com');
  });

  it('URL-encodes URL-prefix properties (slashes)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ rows: [] }), { status: 200 }),
    );
    await querySearchAnalytics('t', 'https://example.com/', { startDate: 'x', endDate: 'y' });
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https%3A%2F%2Fexample.com%2F');
  });

  it('returns [] when the response has no rows field (zero-data window)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await querySearchAnalytics('t', 'sc-domain:x.com', { startDate: 'x', endDate: 'y' }))
      .toEqual([]);
  });

  it('flags 403/404 as user errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Forbidden', { status: 403 }));
    try {
      await querySearchAnalytics('t', 'sc-domain:x.com', { startDate: 'x', endDate: 'y' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(GscApiError);
      expect((err as GscApiError).userError).toBe(true);
      expect((err as GscApiError).status).toBe(403);
    }
  });

  it('does NOT flag 500 as a user error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Internal', { status: 500 }));
    try {
      await querySearchAnalytics('t', 'sc-domain:x.com', { startDate: 'x', endDate: 'y' });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as GscApiError).userError).toBe(false);
    }
  });
});
