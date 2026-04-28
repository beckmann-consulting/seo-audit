// Maps the Phase G1 env-config + fetchGscData result onto the
// public GscResult discriminated union the route ships in
// AuditResult.gscResult. Lives next to the rest of the GSC code so
// the mapping rules are co-located with the data layer they map.
//
// Why a separate helper: the route handler is hard to unit-test
// (requires faking the SSE controller, AuditConfig, all upstream
// pipeline state). Pulling the GSC-result-shaping into a pure
// function lets the four state paths get covered cheaply.

import type { GscResult, StreamEvent } from '@/types';
import { fetchGscData, type GscFetchResult } from './index';

export interface ResolveGscResultOptions {
  domain: string;
  refreshToken?: string;
  // Test seam: stub the real fetchGscData call.
  fetcher?: (domain: string, refreshToken: string) => Promise<GscFetchResult>;
}

const defaultFetcher = (domain: string, refreshToken: string) =>
  fetchGscData(domain, { type: 'env-refresh-token', refreshToken });

// Emit a single mid-stream warning when GSC's API failed
// transiently (5xx / network / unmapped). The other three states
// are intentional outcomes already conveyed by gscResult in the
// final result, so this lets the live UI react without polluting
// the result payload itself.
//
// TODO(persistence): warnings are deliberately ephemeral — they
// live only on the SSE stream, not in AuditResult. The trade-off:
// AuditResult captures site-state findings (what's wrong with the
// site), warnings capture run-mechanics (what happened during
// _this_ audit run). If a future feature needs warnings to
// survive past the stream — e.g. surface them in cached audits or
// in the JSON export — revisit this decision before refactoring,
// because moving warnings into AuditResult muddles those two
// concerns.
export function emitGscWarning(
  result: GscResult,
  send: (event: StreamEvent) => void,
): void {
  if (result.state === 'api-error') {
    send({ type: 'warning', source: 'gsc', message: result.message });
  }
}

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
