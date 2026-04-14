import { parse } from 'node-html-parser';
import type { PageData, CrawlStats } from '@/types';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; SEOAuditPro/2.0; +https://beckmanndigital.com)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en,de;q=0.9',
};

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
  onProgress?: (crawled: number, total: number, currentUrl: string) => void
): Promise<{ pages: PageData[]; stats: CrawlStats }> {
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  const pages: PageData[] = [];
  const brokenLinks: string[] = [];
  const redirectChains: { from: string; to: string }[] = [];
  let externalLinkCount = 0;

  const baseDomain = new URL(startUrl).hostname;

  while (queue.length > 0) {
    if (maxPages > 0 && pages.length >= maxPages) break;

    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);

    onProgress?.(pages.length, queue.length + pages.length + 1, url);

    try {
      const start = Date.now();
      const resp = await fetch(url, {
        headers: HEADERS,
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      const loadTime = Date.now() - start;

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        continue;
      }

      // Track redirects
      if (resp.url !== url) {
        redirectChains.push({ from: url, to: resp.url });
      }

      if (!resp.ok) {
        brokenLinks.push(url);
        continue;
      }

      const html = await resp.text();
      pages.push({
        url: resp.url,
        html,
        statusCode: resp.status,
        redirectedFrom: resp.url !== url ? url : undefined,
        loadTime,
        contentType,
      });

      // Extract links from this page
      const root = parse(html);
      const anchors = root.querySelectorAll('a[href]');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        try {
          const fullUrl = new URL(href, url);
          if (fullUrl.hostname === baseDomain) {
            const normalized = normalizeUrl(href, url);
            if (normalized && !visited.has(normalized) && !queue.includes(normalized)) {
              queue.push(normalized);
            }
          } else if (href.startsWith('http')) {
            externalLinkCount++;
          }
        } catch {}
      }
    } catch (err) {
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
    },
  };
}
