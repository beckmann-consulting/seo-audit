// Public entry point: fetchGscData(domain, auth) → {ok, data} | {ok:false, ...}.
//
// Orchestrates the four steps an audit needs from GSC:
//   1. Refresh OAuth access token (cached in auth.ts).
//   2. List the user's properties.
//   3. Resolve the audit's domain to one of the five variants
//      (sc-domain preferred — see property-resolver.ts).
//   4. Query the Search Analytics API for two views:
//        - top queries last 28 days
//        - top pages last 28 days
//      Plus an unfiltered totals query (no dimensions) for the
//      headline numbers.
//
// Returns a Result-style discriminated union so the route handler
// can distinguish "user has no GSC access for this property" (404,
// soft, shown as info banner) from "your env is broken" (500, shown
// as error).

import type { GscAuth } from './auth';
import { GscAuthError, getAccessToken } from './auth';
import {
  GscApiError,
  listSites,
  querySearchAnalytics,
} from './client';
import { resolveGscProperty } from './property-resolver';
import type { GscData, GscTotals } from '@/types';

export type { GscAuth } from './auth';
export { describeVariant } from './property-resolver';

// Internal Result-shape used by fetchGscData — the route maps this
// to the user-facing GscResult discriminated union in @/types.
export type GscFetchResult =
  | { ok: true; data: GscData }
  | { ok: false; error: string; userError: boolean; sitesAvailable?: number };

// Symmetric row limits for queries + pages — easier on the eyes
// in the UI tables and 100 covers the vast majority of audits.
const QUERY_ROW_LIMIT = 100;
const PAGE_ROW_LIMIT = 100;

// 28-day window matches the GSC UI default and gives stable
// percentile numbers even for low-traffic sites.
const LOOKBACK_DAYS = 28;

// 2-day backoff from today: GSC's documented data-lag is "up to
// 4 days" but typical 2 days. With dataState='final' below, we
// only see fully-settled data — no fresh-data leak. 2 days keeps
// the window as current as practical.
const DATA_LAG_DAYS = 2;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - DATA_LAG_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - LOOKBACK_DAYS + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export async function fetchGscData(domain: string, auth: GscAuth): Promise<GscFetchResult> {
  let accessToken: string;
  try {
    accessToken = await getAccessToken(auth);
  } catch (err) {
    if (err instanceof GscAuthError) {
      return { ok: false, error: err.message, userError: err.userError };
    }
    return { ok: false, error: `Auth failed: ${(err as Error).message}`, userError: false };
  }

  let sites: { siteUrl: string }[];
  try {
    sites = await listSites(accessToken);
  } catch (err) {
    if (err instanceof GscApiError) {
      return { ok: false, error: err.message, userError: err.userError };
    }
    return { ok: false, error: `listSites failed: ${(err as Error).message}`, userError: false };
  }

  const resolved = resolveGscProperty(domain, sites.map(s => s.siteUrl));
  if (!resolved) {
    return {
      ok: false,
      error: `Domain "${domain}" is not in your Search Console account. Add the property in https://search.google.com/search-console and re-run.`,
      userError: true,
      sitesAvailable: sites.length,
    };
  }

  const { startDate, endDate } = dateRange();

  // Three parallel queries — totals (no dimensions), top queries,
  // top pages. The GSC API has no per-key rate limit beyond ~1200 QPM
  // per project; three concurrent calls are fine.
  try {
    // dataState: 'final' + searchType: 'web' set explicitly on every
    // call — the API defaults today are 'final' / 'web' but we
    // document intent and protect against future default changes.
    const [totalsRows, queryRows, pageRows] = await Promise.all([
      querySearchAnalytics(accessToken, resolved.siteUrl, {
        startDate, endDate,
        dataState: 'final',
        searchType: 'web',
      }),
      querySearchAnalytics(accessToken, resolved.siteUrl, {
        startDate, endDate,
        dimensions: ['query'],
        rowLimit: QUERY_ROW_LIMIT,
        dataState: 'final',
        searchType: 'web',
      }),
      querySearchAnalytics(accessToken, resolved.siteUrl, {
        startDate, endDate,
        dimensions: ['page'],
        rowLimit: PAGE_ROW_LIMIT,
        dataState: 'final',
        searchType: 'web',
      }),
    ]);

    const totals: GscTotals = totalsRows[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };

    return {
      ok: true,
      data: {
        resolved,
        startDate, endDate,
        totals,
        topQueries: queryRows,
        topPages: pageRows,
      },
    };
  } catch (err) {
    if (err instanceof GscApiError) {
      return { ok: false, error: err.message, userError: err.userError };
    }
    return { ok: false, error: `Search Analytics failed: ${(err as Error).message}`, userError: false };
  }
}
