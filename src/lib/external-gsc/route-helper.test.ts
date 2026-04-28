import { describe, it, expect, vi } from 'vitest';
import { resolveGscResult } from './route-helper';
import type { GscFetchResult } from './index';
import type { GscData } from '@/types';

const sampleData: GscData = {
  resolved: { siteUrl: 'sc-domain:example.com', variant: 'domain' },
  startDate: '2026-03-30',
  endDate: '2026-04-26',
  totals: { clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
  topQueries: [],
  topPages: [],
};

describe('resolveGscResult — four states', () => {
  it('returns state="disabled" when refreshToken is undefined', async () => {
    const fetcher = vi.fn(async (): Promise<GscFetchResult> => ({ ok: true, data: sampleData }));
    const r = await resolveGscResult({ domain: 'example.com', fetcher });
    expect(r).toEqual({ state: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns state="disabled" when refreshToken is empty string', async () => {
    const fetcher = vi.fn();
    const r = await resolveGscResult({ domain: 'example.com', refreshToken: '', fetcher });
    expect(r).toEqual({ state: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns state="ok" with data when fetchGscData succeeds', async () => {
    const fetcher = async (): Promise<GscFetchResult> => ({ ok: true, data: sampleData });
    const r = await resolveGscResult({ domain: 'example.com', refreshToken: 'r', fetcher });
    expect(r).toEqual({ state: 'ok', data: sampleData });
  });

  it('returns state="property-not-found" when userError is true', async () => {
    const fetcher = async (): Promise<GscFetchResult> => ({
      ok: false,
      userError: true,
      error: 'Domain not in your account',
      sitesAvailable: 8,
    });
    const r = await resolveGscResult({ domain: 'example.com', refreshToken: 'r', fetcher });
    expect(r).toEqual({
      state: 'property-not-found',
      domain: 'example.com',
      sitesAvailable: 8,
    });
  });

  it('defaults sitesAvailable to 0 when fetcher omits it', async () => {
    const fetcher = async (): Promise<GscFetchResult> => ({
      ok: false, userError: true, error: 'whatever',
    });
    const r = await resolveGscResult({ domain: 'example.com', refreshToken: 'r', fetcher });
    if (r.state !== 'property-not-found') throw new Error('expected property-not-found');
    expect(r.sitesAvailable).toBe(0);
  });

  it('returns state="api-error" with the message when userError is false', async () => {
    const fetcher = async (): Promise<GscFetchResult> => ({
      ok: false, userError: false, error: 'GSC 503 — service unavailable',
    });
    const r = await resolveGscResult({ domain: 'example.com', refreshToken: 'r', fetcher });
    expect(r).toEqual({ state: 'api-error', message: 'GSC 503 — service unavailable' });
  });

  it('passes domain + refreshToken to the fetcher', async () => {
    const fetcher = vi.fn(async (): Promise<GscFetchResult> => ({ ok: true, data: sampleData }));
    await resolveGscResult({ domain: 'foo.bar', refreshToken: 'TOKEN-XYZ', fetcher });
    expect(fetcher).toHaveBeenCalledWith('foo.bar', 'TOKEN-XYZ');
  });
});

describe('resolveGscResult — discriminated union exhaustiveness', () => {
  it('every returned state is one of the four valid discriminants', async () => {
    const cases: { fetcher: () => Promise<GscFetchResult>; refreshToken?: string; expectedState: string }[] = [
      // disabled
      { refreshToken: undefined, fetcher: vi.fn(), expectedState: 'disabled' },
      // ok
      { refreshToken: 'r', fetcher: async () => ({ ok: true, data: sampleData }), expectedState: 'ok' },
      // property-not-found
      { refreshToken: 'r', fetcher: async () => ({ ok: false, userError: true, error: 'x' }), expectedState: 'property-not-found' },
      // api-error
      { refreshToken: 'r', fetcher: async () => ({ ok: false, userError: false, error: 'y' }), expectedState: 'api-error' },
    ];
    for (const c of cases) {
      const r = await resolveGscResult({ domain: 'example.com', refreshToken: c.refreshToken, fetcher: c.fetcher });
      expect(r.state).toBe(c.expectedState);
    }
  });
});
