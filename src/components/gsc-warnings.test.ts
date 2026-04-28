import { describe, it, expect } from 'vitest';
import { getVisibleGscWarnings } from './gsc-warnings';
import type { GscResult, StreamEvent } from '@/types';

type W = Extract<StreamEvent, { type: 'warning' }>;

const gscW = (message: string): W => ({ type: 'warning', source: 'gsc', message });
const otherW = (source: string, message: string): W => ({ type: 'warning', source, message });

describe('getVisibleGscWarnings — hide-on-api-error rule', () => {
  it('returns empty when state === "api-error" even if GSC warnings are present', () => {
    // The persistent error banner already shows the same message —
    // duplicating it in the stack is pure visual noise.
    const warnings = [gscW('GSC 503 — service unavailable')];
    const state: GscResult = { state: 'api-error', message: 'GSC 503 — service unavailable' };
    expect(getVisibleGscWarnings(warnings, state)).toEqual([]);
  });

  it('returns warnings when state === "ok" (regression guard for future non-error warnings)', () => {
    // Future GSC pipeline changes might emit warnings on partial-data
    // fetches even when overall state is 'ok'. This test locks the
    // contract that those warnings DO surface.
    const w = gscW('Partial fetch: pages query failed, totals returned');
    const state: GscResult = {
      state: 'ok',
      data: {
        resolved: { siteUrl: 'https://example.com/', variant: 'https' },
        startDate: '2026-03-30', endDate: '2026-04-26',
        totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        topQueries: [], topPages: [],
      },
    };
    expect(getVisibleGscWarnings([w], state)).toEqual([w]);
  });

  it('returns warnings when state === "disabled" (future-proof; pipeline currently never emits in this state)', () => {
    const w = gscW('A warning during a disabled state — hypothetical');
    expect(getVisibleGscWarnings([w], { state: 'disabled' })).toEqual([w]);
  });

  it('returns warnings when state === "property-not-found"', () => {
    const w = gscW('Some warning');
    expect(getVisibleGscWarnings([w], { state: 'property-not-found', domain: 'example.com', sitesAvailable: 5 })).toEqual([w]);
  });

  it('returns warnings when gscResult is undefined (audit ran before G1b shipped)', () => {
    const w = gscW('Legacy warning');
    expect(getVisibleGscWarnings([w], undefined)).toEqual([w]);
  });
});

describe('getVisibleGscWarnings — source filter', () => {
  it('filters out warnings from non-gsc sources', () => {
    const warnings = [
      gscW('gsc one'),
      otherW('axe', 'axe one'),
      otherW('browserless', 'browserless one'),
      gscW('gsc two'),
    ];
    const state: GscResult = { state: 'disabled' };
    const out = getVisibleGscWarnings(warnings, state);
    expect(out.map(w => w.message)).toEqual(['gsc one', 'gsc two']);
  });

  it('filters out warnings without a source field', () => {
    const noSource: W = { type: 'warning', message: 'untagged' };
    const out = getVisibleGscWarnings([noSource, gscW('tagged')], { state: 'disabled' });
    expect(out.map(w => w.message)).toEqual(['tagged']);
  });

  it('returns empty when no warnings are present', () => {
    expect(getVisibleGscWarnings([], { state: 'ok', data: { resolved: { siteUrl: 'x', variant: 'https' }, startDate: '', endDate: '', totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, topQueries: [], topPages: [] } })).toEqual([]);
  });
});

describe('getVisibleGscWarnings — preserves order', () => {
  it('returns gsc warnings in the order they were appended', () => {
    const a = gscW('first');
    const b = gscW('second');
    const c = gscW('third');
    const out = getVisibleGscWarnings([a, b, c], { state: 'disabled' });
    expect(out).toEqual([a, b, c]);
  });
});
