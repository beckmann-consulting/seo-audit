// Thin wrapper around the two GSC v3 endpoints we actually use:
//   - GET  /webmasters/v3/sites                                  → list properties
//   - POST /webmasters/v3/sites/{siteUrl}/searchAnalytics/query  → query data
//
// We deliberately do NOT use the `googleapis` npm package — it ships
// the entire Google Discovery client (~30 MB tree-shake-resistant)
// and we only need two endpoints. Direct fetch keeps the bundle
// small and the failure modes obvious.
//
// TODO(rate-limit): GSC's published quotas are 1,200 QPM per
// property and 30,000 QPD per project. Each audit issues 4 calls
// (1× listSites + 3× searchAnalytics) so realistic concurrency on
// twb-server doesn't come close to the limits — but if we ever
// add scheduled-audit fan-out (Phase J), we should:
//   1. Honour the Retry-After header on 429 responses
//   2. Add exponential-backoff retry for 429 / 503 (max 3 attempts)
//   3. Surface per-project quota usage to the operator
// For now: errors are propagated as-is via GscApiError. The
// fetchGscData orchestrator already maps them to userError vs
// operator-error and the route then turns api-errors into a
// graceful gscResult.state = 'api-error'.

const SC_BASE = 'https://searchconsole.googleapis.com/webmasters/v3';

export interface GscSiteEntry {
  siteUrl: string;
  permissionLevel: 'siteOwner' | 'siteFullUser' | 'siteRestrictedUser' | 'siteUnverifiedUser';
}

export interface SearchAnalyticsQuery {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  dimensions?: ('query' | 'page' | 'date' | 'country' | 'device' | 'searchAppearance')[];
  rowLimit?: number;       // 1..25_000, default 1000
  dimensionFilterGroups?: unknown[];
  searchType?: 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
  dataState?: 'final' | 'all';
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export class GscApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly userError = false,
  ) {
    super(message);
    this.name = 'GscApiError';
  }
}

// Test seam — defaults to Google in production.
export interface ClientOptions {
  baseUrl?: string;
}

export async function listSites(
  accessToken: string,
  opts: ClientOptions = {},
): Promise<GscSiteEntry[]> {
  const resp = await fetch(`${opts.baseUrl ?? SC_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new GscApiError(
      `GSC listSites failed (${resp.status}): ${body.slice(0, 200)}`,
      resp.status,
    );
  }
  const data = await resp.json();
  return data.siteEntry ?? [];
}

export async function querySearchAnalytics(
  accessToken: string,
  siteUrl: string,
  query: SearchAnalyticsQuery,
  opts: ClientOptions = {},
): Promise<SearchAnalyticsRow[]> {
  // siteUrl must be encoded — sc-domain:example.com → sc-domain%3Aexample.com
  const encoded = encodeURIComponent(siteUrl);
  const url = `${opts.baseUrl ?? SC_BASE}/sites/${encoded}/searchAnalytics/query`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(query),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    // 404 on a property usually means "you don't have access" — surface
    // as user-error so the route handler can show a useful message.
    const isUserError = resp.status === 403 || resp.status === 404;
    throw new GscApiError(
      `GSC searchAnalytics failed (${resp.status}): ${body.slice(0, 200)}`,
      resp.status,
      isUserError,
    );
  }
  const data = await resp.json();
  return data.rows ?? [];
}
