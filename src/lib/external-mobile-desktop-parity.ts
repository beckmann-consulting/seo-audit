// Mobile/Desktop Content-Parity probe.
//
// Mobile-first indexing means Google ranks the mobile version of a
// page. If the mobile variant ships significantly less content than
// the desktop one (lazy-loaded reviews, hidden tabs that don't
// progressively enhance, "Read more" stubs) the page effectively
// drops a chunk of its ranking surface.
//
// We sample top-N pages by lowest click depth (most important pages
// first) and fetch each twice — once as Googlebot Mobile, once as
// Googlebot Desktop. Word counts are compared; a > 20% gap surfaces
// as the mobile-desktop-mismatch finding.

import type { PageSEOData } from '@/types';
import { resolveUserAgent } from './util/user-agents';
import { countVisibleWords } from './util/visible-text';

const FETCH_TIMEOUT_MS = 12_000;

export interface ParityResult {
  url: string;
  mobileWords: number;
  desktopWords: number;
  // Symmetric ratio of difference: |a-b| / max(a,b). 0 means identical,
  // 1 means one side has nothing. Symmetric so the order in which we
  // assign mobile/desktop doesn't affect the threshold check.
  diffRatio: number;
}

function buildHeaders(
  userAgent: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): HeadersInit {
  const h: Record<string, string> = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  if (authHeader) h['Authorization'] = authHeader;
  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) {
      h[name] = value;
    }
  }
  return h;
}

async function fetchWords(url: string, headers: HeadersInit): Promise<number | undefined> {
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) return undefined;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return undefined;
    const html = await resp.text();
    return countVisibleWords(html);
  } catch {
    return undefined;
  }
}

// Returns parity records for up to `limit` pages, picked by lowest
// click depth (most important pages first). Pages where one of the
// two probes failed are dropped — we can't compute a meaningful diff
// from missing data.
export async function checkMobileDesktopParity(
  pages: PageSEOData[],
  limit: number,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<ParityResult[]> {
  if (limit <= 0 || pages.length === 0) return [];

  const mobileUa = resolveUserAgent({ userAgent: 'googlebot-mobile' });
  const desktopUa = resolveUserAgent({ userAgent: 'googlebot-desktop' });

  // Stable sort by depth ascending. Tied depths preserve crawl order,
  // which roughly corresponds to discovery importance.
  const sample = [...pages]
    .sort((a, b) => a.depth - b.depth)
    .slice(0, limit);

  const out: ParityResult[] = [];
  for (const page of sample) {
    const [mobileWords, desktopWords] = await Promise.all([
      fetchWords(page.url, buildHeaders(mobileUa, authHeader, customHeaders)),
      fetchWords(page.url, buildHeaders(desktopUa, authHeader, customHeaders)),
    ]);
    if (mobileWords === undefined || desktopWords === undefined) continue;
    const max = Math.max(mobileWords, desktopWords);
    const diffRatio = max === 0 ? 0 : Math.abs(mobileWords - desktopWords) / max;
    out.push({ url: page.url, mobileWords, desktopWords, diffRatio });
  }
  return out;
}
