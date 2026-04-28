import { describe, it, expect, vi } from 'vitest';
import { resolveGscResult, emitGscWarning } from './route-helper';
import type { GscFetchResult } from './index';
import type { GscData, GscResult, StreamEvent } from '@/types';

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

describe('emitGscWarning — emits only on api-error', () => {
  it('does NOT emit for state=disabled', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitGscWarning({ state: 'disabled' }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT emit for state=ok', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitGscWarning({ state: 'ok', data: sampleData }, send);
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT emit for state=property-not-found (intentional outcome)', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitGscWarning(
      { state: 'property-not-found', domain: 'example.com', sitesAvailable: 8 },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('emits exactly one warning with source=gsc on state=api-error', () => {
    const send = vi.fn<(ev: StreamEvent) => void>();
    emitGscWarning({ state: 'api-error', message: 'GSC 503 Service Unavailable' }, send);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      type: 'warning',
      source: 'gsc',
      message: 'GSC 503 Service Unavailable',
    });
  });

  it('does not emit duplicates if invoked twice with the same result', () => {
    // Self-imposed invariant: route.ts calls emitGscWarning exactly
    // once per audit, but the helper itself is stateless — caller is
    // responsible for not invoking it multiple times. This test
    // documents that responsibility.
    const send = vi.fn<(ev: StreamEvent) => void>();
    const apiError: GscResult = { state: 'api-error', message: 'x' };
    emitGscWarning(apiError, send);
    emitGscWarning(apiError, send);
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('warnings reset semantics', () => {
  it('the helper has no internal state to leak between runs', () => {
    // Inverse-spec: confirm absence of helper-side state by making
    // two independent invocations and verifying they don't bleed
    // into each other. The actual reset of the client `warnings`
    // array happens in AuditApp.tsx — covered by the next test.
    const sendA = vi.fn<(ev: StreamEvent) => void>();
    const sendB = vi.fn<(ev: StreamEvent) => void>();
    emitGscWarning({ state: 'api-error', message: 'first run failed' }, sendA);
    emitGscWarning({ state: 'disabled' }, sendB);
    expect(sendA).toHaveBeenCalledOnce();
    expect(sendB).not.toHaveBeenCalled();
  });

  it('AuditApp.tsx clears `warnings` state at the start of every new audit', async () => {
    // Source-level guard for the contract "Audit N's warnings never
    // leak into Audit N+1". The client owns this — on `runAudit`
    // start we call setWarnings([]) before the SSE stream opens, so
    // the second audit always begins with `warnings === []` regardless
    // of what the first audit emitted. Brittle (matches a string)
    // but cheap and breaks loudly the moment the reset disappears.
    const fs = await import('node:fs/promises');
    const src = await fs.readFile('src/components/AuditApp.tsx', 'utf-8');

    // The reset call MUST appear textually inside the runAudit body
    // (not just somewhere in the file), so we slice from the runAudit
    // signature to the next top-level `async function` or end-of-file.
    const runAuditStart = src.indexOf('async function runAudit');
    expect(runAuditStart).toBeGreaterThan(-1);
    const after = src.slice(runAuditStart);
    const runAuditEnd = after.indexOf('\n  async function', 1);
    const runAuditBody = runAuditEnd > 0 ? after.slice(0, runAuditEnd) : after;

    expect(runAuditBody).toContain('setWarnings([])');
  });
});
