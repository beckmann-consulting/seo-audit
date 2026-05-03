// The crawler delegates the actual HTTP fetch to a Renderer instance:
// StaticRenderer for the default behaviour and JsRenderer (Browserless)
// when the user opts into rendering=js. Everything else — link
// discovery, queue management, filtering, broken-link tracking — stays
// here and works identically regardless of mode.

import { parse } from 'node-html-parser';
import type { PageData, CrawlStats } from '@/types';
import type { Renderer, RenderResult } from './renderer/types';
import { StaticRenderer } from './renderer/static';
import { urlMatches } from './util/url-filter';
import { classifyAfterRendererThrow } from './util/crawl-classifier';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; SEOAuditPro/2.0; +https://beckmanndigital.com)';

// Compares two hostnames, treating `example.com` and `www.example.com`
// as the same origin. Real subdomains (blog.example.com, shop.…) are
// still distinct — `www` is the only exception, because it's commonly
// used as a display variant of the canonical hostname. Case-insensitive.
//
// Used by the crawler to decide whether a discovered link belongs to
// the audit scope. Without this tolerance, a footer link from
// `https://example.com/` to `https://www.example.com/privacy` is
// dropped, and the privacy-page detection misfires (A9.1 bug).
export function sameHostnameWithWww(a: string, b: string): boolean {
  const stripWww = (h: string) => h.replace(/^www\./i, '').toLowerCase();
  return stripWww(a) === stripWww(b);
}

function normalizeUrl(url: string, base: string): string | null {
  try {
    const u = new URL(url, base);
    // Only same domain (www-tolerant)
    const baseHost = new URL(base).hostname;
    if (!sameHostnameWithWww(u.hostname, baseHost)) return null;
    // Only HTML-likely
    if (/\.(pdf|jpg|jpeg|png|gif|svg|webp|avif|css|js|woff|woff2|ttf|eot|ico|xml|json|zip|mp4|mp3)(\?|$)/i.test(u.pathname)) return null;
    // Remove fragment
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

// Build a PageData from a successful RenderResult. Preserves the
// fields the rest of the audit pipeline already depends on.
function pageDataFromRender(r: RenderResult, requestedUrl: string, depth: number): PageData {
  return {
    url: r.finalUrl,
    html: r.html,
    statusCode: r.status,
    redirectedFrom: r.redirectChain.length > 0 ? requestedUrl : undefined,
    loadTime: r.loadTimeMs,
    contentType: r.contentType,
    depth,
    redirectChain: r.redirectChain,
    finalUrl: r.finalUrl,
    httpStatus: r.status,
    protocol: r.protocol,
    xRobotsTag: r.headers['x-robots-tag'] || undefined,
    // JS-mode-only fields are passed through when present so the
    // js-rendering / js-console-errors findings can read them.
    staticHtml: r.staticHtml,
    staticWordCount: r.staticWordCount,
    consoleErrors: r.consoleErrors,
    failedRequests: r.failedRequests,
    renderMode: r.mode,
    axeViolations: r.axeViolations,
    renderTimeMs: r.renderTimeMs,
    staticVsRenderedDiff: r.staticVsRenderedDiff,
    httpErrors: r.httpErrors,
  };
}

export async function crawlSite(
  startUrl: string,
  maxPages: number = 0,
  onProgress?: (crawled: number, total: number, currentUrl: string) => void,
  userAgent: string = DEFAULT_USER_AGENT,
  includeRegexes: RegExp[] = [],
  excludeRegexes: RegExp[] = [],
  authHeader?: string,
  customHeaders?: Record<string, string>,
  renderer?: Renderer,
  // A9.2 — additional seed URLs (typically extracted from sitemap.xml)
  // that get added to the crawl queue alongside the start URL. Without
  // these, footer-only and multi-language pages stay invisible if the
  // start URL doesn't link to them. Origin-filtered (with www tolerance)
  // so a sitemap that references external domains can't drag the
  // crawler off-site.
  seedUrls?: string[],
): Promise<{ pages: PageData[]; stats: CrawlStats }> {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const pages: PageData[] = [];
  // Split bucket model — see CrawlStats comment in @/types. brokenLinks
  // gets reassembled at the end as httpErrors ∪ unreachable so existing
  // consumers continue to work; renderFailed is a separate signal.
  const httpErrors: { url: string; status: number }[] = [];
  const unreachable: { url: string; reason: string }[] = [];
  const renderFailed: { url: string; reason: string }[] = [];
  const redirectChains: { from: string; to: string }[] = [];
  let externalLinkCount = 0;

  const baseDomain = new URL(startUrl).hostname;

  // Sitemap-derived seeds enter at depth=1 — they're parallel discoveries,
  // not reached by following the start URL. Visited-set deduplication
  // handles overlap with subsequently-discovered links.
  if (seedUrls && seedUrls.length > 0) {
    for (const seed of seedUrls) {
      try {
        const seedHost = new URL(seed).hostname;
        if (sameHostnameWithWww(seedHost, baseDomain)) {
          queue.push({ url: seed, depth: 1 });
        }
      } catch {
        /* skip malformed sitemap entries */
      }
    }
  }

  // Default to a freshly-built StaticRenderer when none is passed. Keeps
  // the test surface small — most call sites just hand over the URL +
  // userAgent and don't think about renderer composition.
  const ownsRenderer = !renderer;
  const activeRenderer: Renderer = renderer ?? new StaticRenderer({
    userAgent, authHeader, customHeaders,
  });

  try {
    while (queue.length > 0) {
      if (maxPages > 0 && pages.length >= maxPages) break;

      const { url, depth } = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      onProgress?.(pages.length, queue.length + pages.length + 1, url);

      try {
        const result = await activeRenderer.fetch(url);

        // Network error / no response — origin unreachable.
        if (result.status === 0) {
          unreachable.push({ url, reason: 'network error or timeout' });
          continue;
        }

        // Track redirects in crawl stats (legacy from/to pairs).
        if (result.redirectChain.length > 0) {
          redirectChains.push({ from: url, to: result.finalUrl });
        }

        // Skip non-HTML content types
        if (!result.contentType || !result.contentType.includes('text/html')) {
          continue;
        }

        // 4xx / 5xx — real HTTP error from the origin.
        if (result.status < 200 || result.status >= 400) {
          httpErrors.push({ url, status: result.status });
          continue;
        }

        // JsRenderer fell back to static after a JS render failure.
        // Page is still pushed to `pages` (static data is enough for
        // most checks); URL is recorded in renderFailed[] so the
        // separate finding can call out the JS-render limitation
        // without claiming the page is broken.
        if (result.jsRenderFailed) {
          renderFailed.push({ url, reason: result.jsRenderFailed.reason });
        }

        pages.push(pageDataFromRender(result, url, depth));

        // Extract links from this page (resolve against the FINAL url after redirects)
        const root = parse(result.html);
        const anchors = root.querySelectorAll('a[href]');
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          try {
            const fullUrl = new URL(href, result.finalUrl);
            if (sameHostnameWithWww(fullUrl.hostname, baseDomain)) {
              const normalized = normalizeUrl(href, result.finalUrl);
              if (normalized && !visited.has(normalized) && !queue.some(q => q.url === normalized)) {
                // Discovered URL — apply user filter. The start URL itself
                // bypasses this check (handled by being seeded directly into
                // the queue before the loop), so users who set a narrow
                // include list still get a working seed crawl.
                if (urlMatches(normalized, includeRegexes, excludeRegexes)) {
                  queue.push({ url: normalized, depth: depth + 1 });
                }
              }
            } else if (href.startsWith('http')) {
              externalLinkCount++;
            }
          } catch {}
        }
      } catch (err) {
        // Renderer threw — typically a JS-render timeout that even the
        // static fallback couldn't recover from. HEAD-probe the URL
        // with the same headers a real browser would send so we can
        // tell apart "URL really 4xx/5xx" from "network unreachable"
        // from "URL is fine, the JS render alone failed".
        const reason = err instanceof Error ? err.message : String(err);
        const probeHeaders: Record<string, string> = { 'User-Agent': userAgent };
        if (authHeader) probeHeaders['Authorization'] = authHeader;
        if (customHeaders) for (const [k, v] of Object.entries(customHeaders)) probeHeaders[k] = v;
        const cls = await classifyAfterRendererThrow(url, reason, probeHeaders);
        if (cls.bucket === 'httpErrors') {
          httpErrors.push({ url, status: cls.status });
        } else if (cls.bucket === 'unreachable') {
          unreachable.push({ url, reason: cls.reason });
        } else {
          renderFailed.push({ url, reason: cls.reason });
        }
      }

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 150));
    }
  } finally {
    if (ownsRenderer) await activeRenderer.close();
  }

  // brokenLinks excludes renderFailed deliberately — see CrawlStats
  // comment in @/types. Render failures aren't broken URLs.
  const brokenLinks: string[] = [
    ...httpErrors.map(e => e.url),
    ...unreachable.map(u => u.url),
  ];

  return {
    pages,
    stats: {
      totalPages: visited.size,
      crawledPages: pages.length,
      brokenLinks,
      redirectChains,
      externalLinks: externalLinkCount,
      httpErrors,
      unreachable,
      renderFailed,
    },
  };
}
