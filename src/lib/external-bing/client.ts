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

import type { BingRow } from '@/types';

const BING_BASE = 'https://ssl.bing.com/webmaster/api.svc/json';

export class BingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly userError = false,
  ) {
    super(message);
    this.name = 'BingApiError';
  }
}

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
  const json = await resp.json().catch(() => null) as { d?: RawBingRow[] } | null;
  if (!json || !Array.isArray(json.d)) {
    throw new BingApiError(
      `Bing ${method} returned malformed response (missing "d" array)`,
      resp.status,
      false,
    );
  }
  return json.d.map(parseRow);
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
