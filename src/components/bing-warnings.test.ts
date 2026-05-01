import { describe, it, expect } from 'vitest';
import { getVisibleBingWarnings } from './bing-warnings';
import type { BingResult, StreamEvent } from '@/types';

type W = Extract<StreamEvent, { type: 'warning' }>;

const bingW = (message: string): W => ({ type: 'warning', source: 'bing', message });
const otherW = (source: string, message: string): W => ({ type: 'warning', source, message });

describe('getVisibleBingWarnings — hide-on-api-error rule', () => {
  it('returns empty when state === "api-error" even if Bing warnings are present', () => {
    const warnings = [bingW('Bing 503 — service unavailable')];
    const state: BingResult = { state: 'api-error', message: 'Bing 503 — service unavailable' };
    expect(getVisibleBingWarnings(warnings, state)).toEqual([]);
  });

  it('returns warnings when state === "ok" (regression guard for future non-error warnings)', () => {
    const w = bingW('Partial fetch: pages query failed, totals returned');
    const state: BingResult = {
      state: 'ok',
      data: {
        siteUrl: 'https://example.com/',
        totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        topQueries: [], topPages: [],
      },
    };
    expect(getVisibleBingWarnings([w], state)).toEqual([w]);
  });

  it('returns warnings when state === "disabled" (future-proof; pipeline currently never emits in this state)', () => {
    const w = bingW('A warning during a disabled state — hypothetical');
    expect(getVisibleBingWarnings([w], { state: 'disabled' })).toEqual([w]);
  });

  it('returns warnings when state === "site-not-found"', () => {
    const w = bingW('Some warning');
    expect(getVisibleBingWarnings([w], { state: 'site-not-found', siteUrl: 'https://example.com/' })).toEqual([w]);
  });

  it('returns warnings when bingResult is undefined (audit ran before G3b shipped)', () => {
    const w = bingW('Legacy warning');
    expect(getVisibleBingWarnings([w], undefined)).toEqual([w]);
  });
});

describe('getVisibleBingWarnings — source filter', () => {
  it('filters out warnings from non-bing sources', () => {
    const warnings = [
      bingW('bing one'),
      otherW('gsc', 'gsc one'),
      otherW('axe', 'axe one'),
      bingW('bing two'),
    ];
    const state: BingResult = { state: 'disabled' };
    const out = getVisibleBingWarnings(warnings, state);
    expect(out.map(w => w.message)).toEqual(['bing one', 'bing two']);
  });

  it('filters out warnings without a source field', () => {
    const noSource: W = { type: 'warning', message: 'untagged' };
    const out = getVisibleBingWarnings([noSource, bingW('tagged')], { state: 'disabled' });
    expect(out.map(w => w.message)).toEqual(['tagged']);
  });

  it('returns empty when no warnings are present', () => {
    expect(getVisibleBingWarnings([], { state: 'disabled' })).toEqual([]);
  });
});

describe('getVisibleBingWarnings — preserves order', () => {
  it('returns bing warnings in the order they were appended', () => {
    const a = bingW('first');
    const b = bingW('second');
    const c = bingW('third');
    const out = getVisibleBingWarnings([a, b, c], { state: 'disabled' });
    expect(out).toEqual([a, b, c]);
  });
});
