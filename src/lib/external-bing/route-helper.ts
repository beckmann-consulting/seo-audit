// Maps the Phase G3 env-key + fetchBingData result onto the public
// BingResult discriminated union the route ships in
// AuditResult.bingResult. Lives next to the rest of the Bing code
// so the mapping rules are co-located with the data layer they map.
//
// Same shape as external-gsc/route-helper.ts, with two simplifications:
//   - No domain → siteUrl resolution step (Bing has no list-sites API;
//     the verified-sites filter is implicit via 404 from the stats
//     endpoints, already classified as userError=true in client.ts).
//   - Single env-credential, no DiscriminatedUnion auth shape.
//
// Why a separate helper: the route handler is hard to unit-test
// (requires faking the SSE controller, AuditConfig, all upstream
// pipeline state). Pulling the Bing-result-shaping into a pure
// function lets the four state paths get covered cheaply.

import type { BingResult, StreamEvent } from '@/types';
import { fetchBingData, type BingFetchResult } from './index';

export interface ResolveBingResultOptions {
  siteUrl: string;
  apiKey?: string;
  // Test seam: stub the real fetchBingData call.
  fetcher?: (siteUrl: string, apiKey: string) => Promise<BingFetchResult>;
}

const defaultFetcher = (siteUrl: string, apiKey: string) =>
  fetchBingData(siteUrl, apiKey);

// Emit a single mid-stream warning when Bing's API failed transiently
// (5xx / network / unmapped). The 'disabled' and 'site-not-found'
// states are intentional outcomes already conveyed by bingResult in
// the final result, so this lets the live UI react without polluting
// the result payload.
//
// Same ephemeral-by-design trade-off as emitGscWarning: warnings live
// only on the SSE stream, never in AuditResult or the JSON export.
// If a future feature needs warnings to survive past the stream,
// revisit before refactoring — moving them into AuditResult muddles
// "what's wrong with the site" (findings) with "what happened during
// _this_ audit run" (warnings).
export function emitBingWarning(
  result: BingResult,
  send: (event: StreamEvent) => void,
): void {
  if (result.state === 'api-error') {
    send({ type: 'warning', source: 'bing', message: result.message });
  }
}

export async function resolveBingResult(opts: ResolveBingResultOptions): Promise<BingResult> {
  if (!opts.apiKey) {
    return { state: 'disabled' };
  }
  const fetcher = opts.fetcher ?? defaultFetcher;
  const fetched = await fetcher(opts.siteUrl, opts.apiKey);

  if (fetched.ok) {
    return { state: 'ok', data: fetched.data };
  }
  if (fetched.userError) {
    // userError covers 401/403/404 from client.ts:classifyError —
    // for Bing all three mean "this audit can't get data for this
    // siteUrl with this key". The route surfaces it as site-not-found.
    return { state: 'site-not-found', siteUrl: opts.siteUrl };
  }
  return { state: 'api-error', message: fetched.error };
}
