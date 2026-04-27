// HEAD-probe image URLs to estimate file size from Content-Length.
//
// We send HEAD requests because the audit only needs the size; the
// image bytes themselves don't help us. With a per-request 5s timeout
// and a default cap of 20 URLs, the worst-case wall time is ~100s if
// the origin times out on every probe — typical case is well under
// 5s total because most image servers reply to HEAD instantly.
//
// We deduplicate URLs across all crawled pages first, so a 50-page
// site that reuses the same logo on every page only spends one HEAD
// request on it.

import type { PageSEOData } from '@/types';

export interface ImageSizeResult {
  url: string;
  sizeBytes: number;
  contentType?: string;
}

const HEAD_TIMEOUT_MS = 5000;

// Resolve, dedupe and filter to http(s) image URLs ready to probe.
function collectProbeCandidates(pages: PageSEOData[]): string[] {
  const seen = new Set<string>();
  for (const page of pages) {
    for (const img of page.imageDetails) {
      const raw = img.src;
      if (!raw) continue;
      if (raw.startsWith('data:')) continue;
      try {
        const abs = new URL(raw, page.url);
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
        seen.add(abs.href);
      } catch {
        // ignore malformed
      }
    }
  }
  return [...seen];
}

function buildHeadHeaders(
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): HeadersInit | undefined {
  if (!userAgent && !authHeader && !customHeaders) return undefined;
  const h: Record<string, string> = {};
  if (userAgent) h['User-Agent'] = userAgent;
  if (authHeader) h['Authorization'] = authHeader;
  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) {
      h[name] = value;
    }
  }
  return h;
}

// Probe up to `limit` distinct image URLs across the crawled pages.
// Returns successful measurements only — failed/timed-out probes are
// silently dropped (the audit shouldn't fail because one image server
// hiccupped).
export async function checkImageSizes(
  pages: PageSEOData[],
  limit: number,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<ImageSizeResult[]> {
  if (limit <= 0 || pages.length === 0) return [];

  const candidates = collectProbeCandidates(pages).slice(0, limit);
  const headers = buildHeadHeaders(userAgent, authHeader, customHeaders);
  const out: ImageSizeResult[] = [];

  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers,
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      });
      if (!resp.ok) continue;
      const lenHeader = resp.headers.get('content-length');
      if (!lenHeader) continue;
      const sizeBytes = parseInt(lenHeader, 10);
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) continue;
      const contentType = resp.headers.get('content-type') || undefined;
      out.push({ url: resp.url || url, sizeBytes, contentType });
    } catch {
      // network/timeout/abort — drop silently
    }
  }

  return out;
}
