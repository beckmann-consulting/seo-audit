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

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; SEOAuditPro/2.0; +https://beckmanndigital.com)';

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
): Promise<{ pages: PageData[]; stats: CrawlStats }> {
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }];
  const pages: PageData[] = [];
  const brokenLinks: string[] = [];
  const errorPages: { url: string; status: number }[] = [];
  const redirectChains: { from: string; to: string }[] = [];
  let externalLinkCount = 0;

  const baseDomain = new URL(startUrl).hostname;

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

        // Network error / no response
        if (result.status === 0) {
          brokenLinks.push(url);
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

        // 4xx / 5xx
        if (result.status < 200 || result.status >= 400) {
          brokenLinks.push(url);
          errorPages.push({ url, status: result.status });
          continue;
        }

        pages.push(pageDataFromRender(result, url, depth));

        // Extract links from this page (resolve against the FINAL url after redirects)
        const root = parse(result.html);
        const anchors = root.querySelectorAll('a[href]');
        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          try {
            const fullUrl = new URL(href, result.finalUrl);
            if (fullUrl.hostname === baseDomain) {
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
      } catch {
        brokenLinks.push(url);
      }

      // Small delay to be polite
      await new Promise(r => setTimeout(r, 150));
    }
  } finally {
    if (ownsRenderer) await activeRenderer.close();
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
