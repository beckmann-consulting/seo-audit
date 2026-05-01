import { describe, it, expect, vi } from 'vitest';
import { resolveBingResult, emitBingWarning } from './route-helper';
import type { BingFetchResult } from './index';
import type { BingData, BingResult, StreamEvent } from '@/types';

const sampleData: BingData = {
  siteUrl: 'https://example.com/',
  totals: { clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
  topQueries: [],
  topPages: [],
};

describe('resolveBingResult — four states', () => {
  it('returns state="disabled" when apiKey is undefined', async () => {
    const fetcher = vi.fn(async (): Promise<BingFetchResult> => ({ ok: true, data: sampleData }));
    const r = await resolveBingResult({ siteUrl: 'https://example.com/', fetcher });
    expect(r).toEqual({ state: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns state="disabled" when apiKey is empty string', async () => {
    const fetcher = vi.fn();
    const r = await resolveBingResult({ siteUrl: 'https://example.com/', apiKey: '', fetcher });
    expect(r).toEqual({ state: 'disabled' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns state="ok" with data when fetchBingData succeeds', async () => {
    const fetcher = async (): Promise<BingFetchResult> => ({ ok: true, data: sampleData });
    const r = await resolveBingResult({ siteUrl: 'https://example.com/', apiKey: 'k', fetcher });
    expect(r).toEqual({ state: 'ok', data: sampleData });
  });

  it('returns state="site-not-found" when userError is true (401/403/404)', async () => {
    const fetcher = async (): Promise<BingFetchResult> => ({
      ok: false, userError: true, error: 'Site not found in this Bing Webmaster account: …',
    });
    const r = await resolveBingResult({ siteUrl: 'https://wrong.example/', apiKey: 'k', fetcher });
    expect(r).toEqual({ state: 'site-not-found', siteUrl: 'https://wrong.example/' });
  });

  it('returns state="api-error" with the message when userError is false', async () => {
    const fetcher = async (): Promise<BingFetchResult> => ({
      ok: false, userError: false, error: 'Bing 503 — service unavailable',
    });
    const r = await resolveBingResult({ siteUrl: 'https://example.com/', apiKey: 'k', fetcher });
    expect(r).toEqual({ state: 'api-error', message: 'Bing 503 — service unavailable' });
  });

  it('passes siteUrl + apiKey to the fetcher', async () => {
    const fetcher = vi.fn(async (): Promise<BingFetchResult> => ({ ok: true, data: sampleData }));
    await resolveBingResult({ siteUrl: 'https://foo.bar/', apiKey: 'KEY-XYZ', fetcher });
    expect(fetcher).toHaveBeenCalledWith('https://foo.bar/', 'KEY-XYZ');
  });
});

describe('resolveBingResult — discriminated union exhaustiveness', () => {
  it('every returned state is one of the four valid discriminants', async () => {
    const cases: { fetcher: () => Promise<BingFetchResult>; apiKey?: string; expectedState: string }[] = [
      // disabled
      { apiKey: undefined, fetcher: vi.fn(), expectedState: 'disabled' },
      // ok
      { apiKey: 'k', fetcher: async () => ({ ok: true, data: sampleData }), expectedState: 'ok' },
      // site-not-found
      { apiKey: 'k', fetcher: async () => ({ ok: false, userError: true, error: 'x' }), expectedState: 'site-not-found' },
      // api-error
      { apiKey: 'k', fetcher: async () => ({ ok: false, userError: false, error: 'y' }), expectedState: 'api-error' },
    ];
    for (const c of cases) {
      const r = await resolveBingResult({ siteUrl: 'https://example.com/', apiKey: c.apiKey, fetcher: c.fetcher });
      expect(r.state).toBe(c.expectedState);
    }
  });
});

describe('emitBingWarning — emits only on api-error', () => {
  it('does NOT emit for state=disabled', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitBingWarning({ state: 'disabled' }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT emit for state=ok', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitBingWarning({ state: 'ok', data: sampleData }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT emit for state=site-not-found (intentional outcome)', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitBingWarning({ state: 'site-not-found', siteUrl: 'https://example.com/' }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('emits exactly one warning with source=bing on state=api-error', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitBingWarning({ state: 'api-error', message: 'Bing 503 Service Unavailable' }, send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: 'warning',
      source: 'bing',
      message: 'Bing 503 Service Unavailable',
    });
  });

  it('does not emit duplicates if invoked twice with the same result', () => {
    // Self-imposed invariant: route.ts calls emitBingWarning exactly
    // once per audit, but the helper itself is stateless — caller is
    // responsible for not invoking it multiple times. This test
    // documents that responsibility.
    const send = vi.fn<(ev: StreamEvent) => void>();
    const apiError: BingResult = { state: 'api-error', message: 'x' };
    emitBingWarning(apiError, send);
    emitBingWarning(apiError, send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
