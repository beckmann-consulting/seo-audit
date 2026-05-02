// Thin wrapper around the two Bing Webmaster Tools v1 endpoints we
// actually need:
//   - GET /webmaster/api.svc/json/GetQueryStats?siteUrl={url}&apikey={key}
//   - GET /webmaster/api.svc/json/GetPageStats?siteUrl={url}&apikey={key}
//
// Both return a `{"d": [...]}` envelope with rows aggregated over
// the last ~6 months. CTR is not in the response — we compute it
// at parse time. Position uses AvgImpressionPosition (matches the
// "average position over impressions" semantics GSC uses).
//
// We deliberately do not use the `bing-webmaster-tools` npm package
// for the same reasons GSC bypasses `googleapis`: tiny dependency
// surface, predictable failure modes.
//
// Status-code mapping for graceful-degradation:
//   401 / 403  → userError=true ("API key invalid")
//   404        → userError=true ("siteUrl not in this account")
//   5xx / net  → userError=false ("Bing transient")
//
// Bing also returns 200 OK with an in-body ErrorCode for some auth
// failures (most notably ErrorCode 14 = NotAuthorized when the
// siteUrl isn't verified under this key). We map those to the same
// userError=true classification as the equivalent HTTP status.

import type { BingRow } from '@/types';

const BING_BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

export class BingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly userError = false,
    // BWT in-body ErrorCode (when the failure was reported via a
    // 200-OK envelope rather than an HTTP error status). undefined
    // when the failure was a transport-level HTTP error.
    public readonly errorCode?: number,
  ) {
    super(message);
    this.name = 'BingApiError';
  }
}

// BWT ErrorCodes that mean "this credential can't see this site" —
// the same outcome as HTTP 401/403/404, just delivered in-body.
//   1  = InvalidApiKey
//   3  = NotAuthorized
//   4  = UserNotFound
//   8  = NotFound (e.g. siteUrl unknown to this account)
//   13 = NotAuthorized (variant)
//   14 = NotAuthorized (variant — "site not in your verified list")
// Other ErrorCodes (2 InvalidParameter, 7 TooManyRequests, 9
// InternalError, …) are operator-side / transient and stay as
// userError=false so the UI keeps offering a retry hint.
const BING_AUTH_ERROR_CODES = new Set([1, 3, 4, 8, 13, 14]);

// Test seam — defaults to Bing in production.
export interface ClientOptions {
  baseUrl?: string;
}

// Bing's raw row shape. Field casing is PascalCase (.NET-style JSON);
// we don't expose this to callers — parseRow normalises it.
interface RawBingRow {
  Query?: string;
  Page?: string;
  Clicks?: number;
  Impressions?: number;
  AvgImpressionPosition?: number;
  AvgClickPosition?: number;
  // Other fields exist (Date, Country, …) — not consumed.
}

function safeRatio(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

function parseRow(raw: RawBingRow): BingRow {
  const clicks = raw.Clicks ?? 0;
  const impressions = raw.Impressions ?? 0;
  return {
    query: raw.Query,
    page: raw.Page,
    clicks,
    impressions,
    ctr: safeRatio(clicks, impressions),
    position: raw.AvgImpressionPosition ?? 0,
  };
}

function classifyError(status: number, body: string): BingApiError {
  const userError = status === 401 || status === 403 || status === 404;
  const reason = status === 401 || status === 403
    ? 'API key invalid or unauthorised'
    : status === 404
      ? 'Site not found in this Bing Webmaster account'
      : `Bing API ${status}`;
  return new BingApiError(`${reason}: ${body.slice(0, 200)}`, status, userError);
}

// In-body envelope variants we have to handle:
//   { d: [...] }                                       → success
//   { ErrorCode: 14, Message: "NotAuthorized" }        → top-level error
//   { d: { ErrorCode: 14, Message: "NotAuthorized" } } → wrapped error
// The auth-failure envelopes get classified to userError=true exactly
// like a 401/403/404 would, so the UI lands on the site-not-found
// path instead of a red retry-banner.
interface BingErrorEnvelope {
  ErrorCode?: number;
  Message?: string;
}

function extractInBodyError(json: unknown): BingErrorEnvelope | null {
  if (!json || typeof json !== 'object') return null;
  const top = json as { d?: unknown; ErrorCode?: unknown; Message?: unknown };
  if (typeof top.ErrorCode === 'number') {
    return { ErrorCode: top.ErrorCode, Message: typeof top.Message === 'string' ? top.Message : undefined };
  }
  if (top.d && typeof top.d === 'object' && !Array.isArray(top.d)) {
    const inner = top.d as { ErrorCode?: unknown; Message?: unknown };
    if (typeof inner.ErrorCode === 'number') {
      return { ErrorCode: inner.ErrorCode, Message: typeof inner.Message === 'string' ? inner.Message : undefined };
    }
  }
  return null;
}

async function callBing(
  method: 'GetQueryStats' | 'GetPageStats',
  apiKey: string,
  siteUrl: string,
  opts: ClientOptions,
): Promise<BingRow[]> {
  const base = opts.baseUrl ?? BING_BASE;
  const url = `${base}/${method}?siteUrl=${encodeURIComponent(siteUrl)}&apikey=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw classifyError(resp.status, body);
  }
  const json = await resp.json().catch(() => null) as unknown;

  const inBodyError = extractInBodyError(json);
  if (inBodyError) {
    const isAuthError = inBodyError.ErrorCode !== undefined && BING_AUTH_ERROR_CODES.has(inBodyError.ErrorCode);
    const msg = inBodyError.Message ?? 'Unknown error';
    throw new BingApiError(
      `Bing ${method} ErrorCode ${inBodyError.ErrorCode}: ${msg}`,
      resp.status,
      isAuthError,
      inBodyError.ErrorCode,
    );
  }

  const envelope = json as { d?: RawBingRow[] } | null;
  if (!envelope || !Array.isArray(envelope.d)) {
    throw new BingApiError(
      `Bing ${method} returned malformed response (missing "d" array)`,
      resp.status,
      false,
    );
  }
  return envelope.d.map(parseRow);
}

export async function getQueryStats(
  apiKey: string,
  siteUrl: string,
  opts: ClientOptions = {},
): Promise<BingRow[]> {
  return callBing('GetQueryStats', apiKey, siteUrl, opts);
}

export async function getPageStats(
  apiKey: string,
  siteUrl: string,
  opts: ClientOptions = {},
): Promise<BingRow[]> {
  return callBing('GetPageStats', apiKey, siteUrl, opts);
}
