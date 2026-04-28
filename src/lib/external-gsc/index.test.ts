import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fetchGscData } from './index';
import { _resetTokenCacheForTests } from './auth';

const ENV_BACKUP = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
};

beforeEach(() => {
  _resetTokenCacheForTests();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = ENV_BACKUP.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = ENV_BACKUP.GOOGLE_OAUTH_CLIENT_SECRET;
});

// Sequence of canned responses: token → listSites → totals → topQueries → topPages.
function happyPathFetchSequence(siteUrl: string) {
  let call = 0;
  return vi.fn().mockImplementation(async (url: string) => {
    call++;
    if (call === 1) {
      // Token endpoint
      return new Response(JSON.stringify({ access_token: 'A', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    }
    if (String(url).endsWith('/sites')) {
      return new Response(JSON.stringify({ siteEntry: [{ siteUrl, permissionLevel: 'siteOwner' }] }), { status: 200 });
    }
    // Three searchAnalytics calls in parallel — order isn't guaranteed.
    // Differentiate by body to return appropriate fixtures.
    return new Response(JSON.stringify({ rows: [
      { keys: ['demo-key'], clicks: 1, impressions: 10, ctr: 0.1, position: 5 },
    ] }), { status: 200 });
  });
}

describe('fetchGscData — orchestration', () => {
  it('runs the four-step pipeline and returns ok with resolved property', async () => {
    vi.stubGlobal('fetch', happyPathFetchSequence('sc-domain:example.com'));
    const result = await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.resolved.siteUrl).toBe('sc-domain:example.com');
      expect(result.data.resolved.variant).toBe('domain');
      expect(typeof result.data.startDate).toBe('string');
      expect(typeof result.data.endDate).toBe('string');
    }
  });

  it('returns userError=true with a friendly message when no property matches', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ access_token: 'A', expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:other.com', permissionLevel: 'siteOwner' }] }), { status: 200 });
    }));
    const result = await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userError).toBe(true);
      expect(result.error).toMatch(/not in your Search Console/);
    }
  });

  it('propagates auth errors with userError=false (env misconfig is operator-side)', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const result = await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userError).toBe(false);
      expect(result.error).toMatch(/CLIENT_ID/);
    }
  });

  it('marks 403 from searchAnalytics as userError', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ access_token: 'A', expires_in: 3600 }), { status: 200 });
      if (String(url).endsWith('/sites')) return new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteRestrictedUser' }] }), { status: 200 });
      return new Response('Forbidden', { status: 403 });
    }));
    const result = await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.userError).toBe(true);
      expect(result.error).toMatch(/403/);
    }
  });

  it('uses a 28-day window ending 2 days before today (DATA_LAG_DAYS)', async () => {
    vi.stubGlobal('fetch', happyPathFetchSequence('sc-domain:example.com'));
    const result = await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const start = new Date(result.data.startDate);
      const end = new Date(result.data.endDate);
      const days = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      expect(days).toBe(27); // 28 days inclusive → 27 days delta
      // End date is 2 days behind today
      const today = new Date();
      const expectedEnd = new Date(today);
      expectedEnd.setUTCDate(expectedEnd.getUTCDate() - 2);
      expect(result.data.endDate).toBe(expectedEnd.toISOString().slice(0, 10));
    }
  });

  it('sends dataState=final + searchType=web on every searchAnalytics call', async () => {
    const seenBodies: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'A', expires_in: 3600 }), { status: 200 });
      }
      if (u.endsWith('/sites')) {
        return new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] }), { status: 200 });
      }
      // searchAnalytics
      if (init?.body) seenBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }));

    const r = await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    expect(r.ok).toBe(true);
    expect(seenBodies).toHaveLength(3);
    for (const body of seenBodies) {
      expect((body as { dataState: string }).dataState).toBe('final');
      expect((body as { searchType: string }).searchType).toBe('web');
    }
  });

  it('uses 100/100 row limits on the dimension queries', async () => {
    const seenBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'A', expires_in: 3600 }), { status: 200 });
      }
      if (u.endsWith('/sites')) {
        return new Response(JSON.stringify({ siteEntry: [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }] }), { status: 200 });
      }
      if (init?.body) seenBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    }));

    await fetchGscData('example.com', { type: 'env-refresh-token', refreshToken: 'r1' });
    const queryCall = seenBodies.find(b => Array.isArray(b.dimensions) && (b.dimensions as string[]).includes('query'));
    const pageCall = seenBodies.find(b => Array.isArray(b.dimensions) && (b.dimensions as string[]).includes('page'));
    expect(queryCall?.rowLimit).toBe(100);
    expect(pageCall?.rowLimit).toBe(100);
  });
});
