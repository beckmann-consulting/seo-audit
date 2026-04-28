// Maps the Phase G1 env-config + fetchGscData result onto the
// public GscResult discriminated union the route ships in
// AuditResult.gscResult. Lives next to the rest of the GSC code so
// the mapping rules are co-located with the data layer they map.
//
// Why a separate helper: the route handler is hard to unit-test
// (requires faking the SSE controller, AuditConfig, all upstream
// pipeline state). Pulling the GSC-result-shaping into a pure
// function lets the four state paths get covered cheaply.

import type { GscResult } from '@/types';
import { fetchGscData, type GscFetchResult } from './index';

export interface ResolveGscResultOptions {
  domain: string;
  refreshToken?: string;
  // Test seam: stub the real fetchGscData call.
  fetcher?: (domain: string, refreshToken: string) => Promise<GscFetchResult>;
}

const defaultFetcher = (domain: string, refreshToken: string) =>
  fetchGscData(domain, { type: 'env-refresh-token', refreshToken });

export async function resolveGscResult(opts: ResolveGscResultOptions): Promise<GscResult> {
  if (!opts.refreshToken) {
    return { state: 'disabled' };
  }
  const fetcher = opts.fetcher ?? defaultFetcher;
  const fetched = await fetcher(opts.domain, opts.refreshToken);

  if (fetched.ok) {
    return { state: 'ok', data: fetched.data };
  }
  if (fetched.userError) {
    return {
      state: 'property-not-found',
      domain: opts.domain,
      sitesAvailable: fetched.sitesAvailable ?? 0,
    };
  }
  return { state: 'api-error', message: fetched.error };
}
