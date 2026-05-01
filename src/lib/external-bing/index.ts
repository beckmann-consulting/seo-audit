// Public entry point: fetchBingData(siteUrl, apiKey) → {ok, data} | {ok:false, ...}.
//
// Orchestrates the two parallel calls an audit needs from Bing:
//   1. getQueryStats — top search terms over the API's last-6-months
//      window (Bing aggregates server-side; no per-call date range).
//   2. getPageStats — top URLs with click + impression counts over
//      the same window.
//
// Site verification is implicit: if the siteUrl isn't on the API
// key's verified-sites list, Bing returns 404, which the client
// classifies as userError=true → site-not-found in the orchestrator
// result. There's no separate "list sites" step (unlike GSC) because
// Bing doesn't expose one; users verify sites in the Bing UI and
// then the API just answers per siteUrl.
//
// Returns a Result-style discriminated union so the route handler
// can map it onto the user-facing BingResult shape in @/types.

import {
  BingApiError,
  getQueryStats,
  getPageStats,
} from './client';
import type { BingData, BingTotals, BingRow } from '@/types';

export type BingFetchResult =
  | { ok: true; data: BingData }
  | { ok: false; error: string; userError: boolean };

// Aggregate row-level metrics into the headline totals shown in the
// banner. Position is impression-weighted to match GSC semantics.
function aggregateTotals(rows: BingRow[]): BingTotals {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weightedPosition += r.position * r.impressions;
  }
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position = impressions > 0 ? weightedPosition / impressions : 0;
  return { clicks, impressions, ctr, position };
}

export async function fetchBingData(siteUrl: string, apiKey: string): Promise<BingFetchResult> {
  try {
    const [queryRows, pageRows] = await Promise.all([
      getQueryStats(apiKey, siteUrl),
      getPageStats(apiKey, siteUrl),
    ]);

    const totals = aggregateTotals(queryRows);

    return {
      ok: true,
      data: {
        siteUrl,
        totals,
        topQueries: queryRows,
        topPages: pageRows,
      },
    };
  } catch (err) {
    if (err instanceof BingApiError) {
      return { ok: false, error: err.message, userError: err.userError };
    }
    return {
      ok: false,
      error: `Bing fetch failed: ${(err as Error).message}`,
      userError: false,
    };
  }
}
