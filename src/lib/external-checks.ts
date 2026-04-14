import type { SSLInfo, DNSInfo, PageSpeedData, SafeBrowsingData } from '@/types';
import { promises as dns } from 'dns';

// ============================================================
//  SSL CHECK via SSL Labs API (no key required)
// ============================================================
export async function checkSSL(domain: string): Promise<SSLInfo> {
  try {
    // Trigger analysis
    const triggerUrl = `https://api.ssllabs.com/api/v3/analyze?host=${domain}&startNew=on&all=done`;
    await fetch(triggerUrl, { signal: AbortSignal.timeout(10000) });

    // Poll for result (max 30s)
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const resp = await fetch(
        `https://api.ssllabs.com/api/v3/analyze?host=${domain}&all=done`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.status === 'READY' && data.endpoints?.length > 0) {
        const ep = data.endpoints[0];
        const cert = ep.details?.cert;
        const expiresMs = cert?.notAfter;
        const expiresAt = expiresMs ? new Date(expiresMs).toISOString() : undefined;
        const daysUntilExpiry = expiresMs
          ? Math.floor((expiresMs - Date.now()) / 86400000)
          : undefined;
        return {
          valid: ep.grade !== 'T' && ep.grade !== 'F',
          grade: ep.grade,
          issuer: cert?.issuerSubject,
          expiresAt,
          daysUntilExpiry,
          protocols: ep.details?.protocols?.map((p: { name: string; version: string }) => `${p.name} ${p.version}`),
        };
      }
      if (data.status === 'ERROR') break;
    }
    // Fallback: simple HTTPS check
    const r = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    return { valid: r.ok, grade: 'unknown (SSL Labs timeout)' };
  } catch (err) {
    // Simple fallback
    try {
      const r = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(8000) });
      return { valid: r.ok };
    } catch {
      return { valid: false, error: String(err) };
    }
  }
}

// ============================================================
//  DNS CHECK (SPF, DKIM, DMARC, MX)
// ============================================================
export async function checkDNS(domain: string): Promise<DNSInfo> {
  try {
    // SPF
    let hasSPF = false;
    let spfRecord: string | undefined;
    try {
      const txtRecords = await dns.resolveTxt(domain);
      for (const record of txtRecords) {
        const str = record.join('');
        if (str.startsWith('v=spf1')) {
          hasSPF = true;
          spfRecord = str;
        }
      }
    } catch {}

    // DMARC
    let hasDMARC = false;
    let dmarcRecord: string | undefined;
    try {
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
      for (const record of dmarcRecords) {
        const str = record.join('');
        if (str.startsWith('v=DMARC1')) {
          hasDMARC = true;
          dmarcRecord = str;
        }
      }
    } catch {}

    // DKIM (common selectors)
    let hasDKIM = false;
    const selectors = ['default', 'google', 'k1', 'mail', 'dkim', 'selector1', 'selector2'];
    for (const selector of selectors) {
      try {
        const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
        if (records.length > 0) {
          hasDKIM = true;
          break;
        }
      } catch {}
    }

    // MX
    let mxRecords: string[] = [];
    try {
      const mx = await dns.resolveMx(domain);
      mxRecords = mx.map(r => r.exchange).slice(0, 5);
    } catch {}

    return { hasSPF, hasDKIM, hasDMARC, spfRecord, dmarcRecord, mxRecords };
  } catch (err) {
    return { hasSPF: false, hasDKIM: false, hasDMARC: false, error: String(err) };
  }
}

// ============================================================
//  PAGESPEED INSIGHTS API
// ============================================================
export async function checkPageSpeed(url: string, apiKey: string): Promise<PageSpeedData> {
  try {
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&key=${apiKey}`;
    const resp = await fetch(endpoint, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) {
      const err = await resp.text();
      return { error: `PageSpeed API error: ${resp.status} — ${err.substring(0, 200)}` };
    }
    const data = await resp.json();
    const cats = data.lighthouseResult?.categories;
    const audits = data.lighthouseResult?.audits;
    const cruxMetrics = data.loadingExperience?.metrics;

    return {
      performanceScore: cats?.performance?.score != null ? Math.round(cats.performance.score * 100) : undefined,
      accessibilityScore: cats?.accessibility?.score != null ? Math.round(cats.accessibility.score * 100) : undefined,
      seoScore: cats?.seo?.score != null ? Math.round(cats.seo.score * 100) : undefined,
      bestPracticesScore: cats?.['best-practices']?.score != null ? Math.round(cats['best-practices'].score * 100) : undefined,
      lcp: audits?.['largest-contentful-paint']?.numericValue,
      cls: audits?.['cumulative-layout-shift']?.numericValue,
      fid: audits?.['max-potential-fid']?.numericValue,
      inp: cruxMetrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile,
      fidField: cruxMetrics?.FIRST_INPUT_DELAY_MS?.percentile,
      ttfb: audits?.['server-response-time']?.numericValue,
      fcp: audits?.['first-contentful-paint']?.numericValue,
      si: audits?.['speed-index']?.numericValue,
      tbt: audits?.['total-blocking-time']?.numericValue,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

// ============================================================
//  GOOGLE SAFE BROWSING API
// ============================================================
export async function checkSafeBrowsing(url: string, apiKey: string): Promise<SafeBrowsingData> {
  try {
    const resp = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: { clientId: 'seo-audit-pro', clientVersion: '2.0' },
          threatInfo: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: [{ url }],
          },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!resp.ok) return { isSafe: true, error: `API error: ${resp.status}` };
    const data = await resp.json();
    const matches = data.matches || [];
    return {
      isSafe: matches.length === 0,
      threats: matches.map((m: { threatType: string }) => m.threatType),
    };
  } catch (err) {
    return { isSafe: true, error: String(err) };
  }
}

// ============================================================
//  ROBOTS.TXT & SITEMAP CHECK
// ============================================================
export async function checkRobotsAndSitemap(baseUrl: string): Promise<{
  hasRobots: boolean;
  hasSitemap: boolean;
  robotsContent?: string;
  sitemapUrl?: string;
}> {
  const origin = new URL(baseUrl).origin;
  let hasRobots = false;
  let hasSitemap = false;
  let robotsContent: string | undefined;
  let sitemapUrl: string | undefined;

  // Check robots.txt
  try {
    const r = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      hasRobots = true;
      robotsContent = await r.text();
      // Extract sitemap from robots.txt
      const sitemapMatch = robotsContent.match(/Sitemap:\s*(\S+)/i);
      if (sitemapMatch) sitemapUrl = sitemapMatch[1];
    }
  } catch {}

  // Check sitemap.xml directly
  if (!hasSitemap) {
    try {
      const r = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        hasSitemap = true;
        if (!sitemapUrl) sitemapUrl = `${origin}/sitemap.xml`;
      }
    } catch {}
  }

  // Also check sitemap_index.xml
  if (!hasSitemap) {
    try {
      const r = await fetch(`${origin}/sitemap_index.xml`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        hasSitemap = true;
        if (!sitemapUrl) sitemapUrl = `${origin}/sitemap_index.xml`;
      }
    } catch {}
  }

  return { hasRobots, hasSitemap, robotsContent, sitemapUrl };
}
