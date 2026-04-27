import { parse } from 'node-html-parser';
import type { PageData, CrawlStats } from '@/types';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; SEOAuditPro/2.0; +https://beckmanndigital.com)';

function buildHeaders(userAgent: string): HeadersInit {
  return {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en,de;q=0.9',
  };
}

const MAX_REDIRECT_HOPS = 10;

interface FetchWithRedirectsResult {
  response?: Response;
  chain: string[]; // URLs visited in order (excluding the final one)
  finalUrl: string;
  loopDetected: boolean;
  error?: string;
}

// Follows redirects manually so we can record the full chain, detect
// loops, and spot protocol downgrades. Returns the last response
// along with the ordered list of intermediate URLs.
async function fetchWithRedirectTracking(startUrl: string, userAgent: string): Promise<FetchWithRedirectsResult> {
  const chain: string[] = [];
  let currentUrl = startUrl;
  let loopDetected = false;
  const headers = buildHeaders(userAgent);

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    try {
      const resp = await fetch(currentUrl, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });

      // 3xx with Location → follow
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get('location');
        if (!location) {
          return { response: resp, chain, finalUrl: currentUrl, loopDetected };
        }
        let nextUrl: string;
        try {
          nextUrl = new URL(location, currentUrl).href;
        } catch {
          return { response: resp, chain, finalUrl: currentUrl, loopDetected };
        }
        chain.push(currentUrl);
        if (chain.includes(nextUrl)) {
          loopDetected = true;
          return { response: resp, chain, finalUrl: nextUrl, loopDetected };
        }
        currentUrl = nextUrl;
        continue;
      }

      // Non-redirect → done
      return { response: resp, chain, finalUrl: currentUrl, loopDetected };
    } catch (err) {
      return { chain, finalUrl: currentUrl, loopDetected, error: String(err) };
    }
  }

  // Exhausted hop budget
  return { chain, finalUrl: currentUrl, loopDetected: true, error: `Exceeded ${MAX_REDIRECT_HOPS} redirect hops` };
}

function normalizeUrl(url: string, base: string): string | null {
  try {
    const u = new URL(url, base);
    // Only same domain
    const baseHost = new URL(base).hostname;
    if (u.hostname !== baseHost) return null;
    // Only HTML-likely
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|avif|css|js|woff|woff2|ttf|eot|ico|xml|json|zip|mp4|mp3)(\?|$)/i.test(u.pathname)) return null;
    // Remove fragment
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

export async function crawlSite(
  startUrl: string,
  maxPages: number = 0,
  onProgress?: (crawled: number, total: number, currentUrl: string) => void,
  userAgent: string = DEFAULT_USER_AGENT
): Promise<{ pages: PageData[]; stats: CrawlStats }> {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const pages: PageData[] = [];
  const brokenLinks: string[] = [];
  const errorPages: { url: string; status: number }[] = [];
  const redirectChains: { from: string; to: string }[] = [];
  let externalLinkCount = 0;

  const baseDomain = new URL(startUrl).hostname;

  while (queue.length > 0) {
    if (maxPages > 0 && pages.length >= maxPages) break;

    const { url, depth } = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    onProgress?.(pages.length, queue.length + pages.length + 1, url);

    try {
      const start = Date.now();
      const tracked = await fetchWithRedirectTracking(url, userAgent);
      const resp = tracked.response;
      const loadTime = Date.now() - start;

      if (!resp) {
        brokenLinks.push(url);
        continue;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        continue;
      }

      // Track redirects in crawl stats (legacy from/to pairs for compatibility)
      if (tracked.chain.length > 0) {
        redirectChains.push({ from: url, to: tracked.finalUrl });
      }

      if (!resp.ok) {
        brokenLinks.push(url);
        errorPages.push({ url, status: resp.status });
        continue;
      }

      const html = await resp.text();
      // Protocol heuristic — Node's fetch doesn't expose the wire protocol.
      // alt-svc / via headers are the closest proxy we can check.
      const altSvc = resp.headers.get('alt-svc') || '';
      const viaHeader = resp.headers.get('via') || '';
      let protocol: string | null = null;
      if (/\bh3\b|\bh2\b|hq=/i.test(altSvc)) protocol = 'h2';
      else if (/2\.0/.test(viaHeader)) protocol = 'h2';

      // X-Robots-Tag — Node's Headers.get() joins multiple values with ', '.
      // We keep the raw string and let the parser handle splitting.
      const xRobotsTag = resp.headers.get('x-robots-tag') || undefined;

      pages.push({
        url: tracked.finalUrl,
        html,
        statusCode: resp.status,
        redirectedFrom: tracked.chain.length > 0 ? url : undefined,
        loadTime,
        contentType,
        depth,
        redirectChain: tracked.chain,
        finalUrl: tracked.finalUrl,
        httpStatus: resp.status,
        protocol,
        xRobotsTag,
      });

      // Extract links from this page (resolve against the FINAL url after redirects)
      const root = parse(html);
      const anchors = root.querySelectorAll('a[href]');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        try {
          const fullUrl = new URL(href, tracked.finalUrl);
          if (fullUrl.hostname === baseDomain) {
            const normalized = normalizeUrl(href, tracked.finalUrl);
            if (normalized && !visited.has(normalized) && !queue.some(q => q.url === normalized)) {
              queue.push({ url: normalized, depth: depth + 1 });
            }
          } else if (href.startsWith('http')) {
            externalLinkCount++;
          }
        } catch {}
      }
    } catch {
      brokenLinks.push(url);
    }

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 150));
  }

  return {
    pages,
    stats: {
      totalPages: visited.size,
      crawledPages: pages.length,
      brokenLinks,
      redirectChains,
      externalLinks: externalLinkCount,
      errorPages,
    },
  };
}
