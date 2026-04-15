import type {
  SSLInfo, DNSInfo, PageSpeedData, SafeBrowsingData,
  SecurityHeadersInfo, AIReadinessInfo, AIBotRule, AIBotStatus,
  SitemapInfo, SitemapUrlEntry,
} from '@/types';
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

    // Lighthouse 'structured-data' is typically a manual audit (scoreDisplayMode: 'manual')
    // — when present with a <1 score or with warnings, we surface the title string.
    const structuredDataAudit = audits?.['structured-data'];
    const structuredDataAuditWarning = structuredDataAudit && structuredDataAudit.score !== null && structuredDataAudit.score < 1
      ? (structuredDataAudit.title || 'Structured data audit flagged issues')
      : undefined;

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
      structuredDataAuditWarning,
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
//  SECURITY HEADERS CHECK
// ============================================================
export async function checkSecurityHeaders(url: string, html?: string): Promise<SecurityHeadersInfo> {
  try {
    // Use GET (not HEAD) because some servers handle HEAD differently
    // and we want the exact headers a real browser would see.
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    const h = resp.headers;
    const hsts = h.get('strict-transport-security') || undefined;
    const csp = h.get('content-security-policy') || h.get('content-security-policy-report-only') || undefined;
    const xFrameOptions = h.get('x-frame-options') || undefined;
    const xContentTypeOptions = h.get('x-content-type-options') || undefined;
    const referrerPolicy = h.get('referrer-policy') || undefined;
    const permissionsPolicy = h.get('permissions-policy') || h.get('feature-policy') || undefined;
    const setCookie = h.get('set-cookie') || '';

    // Parse HSTS max-age + includeSubDomains
    let hstsMaxAge: number | undefined;
    let hstsIncludeSubDomains: boolean | undefined;
    if (hsts) {
      const maxAgeMatch = hsts.match(/max-age\s*=\s*(\d+)/i);
      if (maxAgeMatch) hstsMaxAge = parseInt(maxAgeMatch[1], 10);
      hstsIncludeSubDomains = /includeSubDomains/i.test(hsts);
    }

    // Cookie security: if any cookies are set, they should have Secure flag
    let hasCookieSecure: boolean | undefined;
    if (setCookie) {
      hasCookieSecure = /;\s*secure/i.test(setCookie);
    }

    // Mixed content: detect http:// resources in HTTPS-served HTML
    let hasMixedContent: boolean | undefined;
    if (html && url.startsWith('https://')) {
      const mixedPattern = /(?:src|href)\s*=\s*["']http:\/\/(?!localhost)/i;
      hasMixedContent = mixedPattern.test(html);
    }

    return {
      hsts,
      hstsMaxAge,
      hstsIncludeSubDomains,
      csp,
      xFrameOptions,
      xContentTypeOptions,
      referrerPolicy,
      permissionsPolicy,
      hasCookieSecure,
      hasMixedContent,
      checkedUrl: resp.url,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

// ============================================================
//  AI CRAWLER READINESS CHECK
// ============================================================
// Known AI crawlers. "purpose" distinguishes training bots (use site
// content to train LLMs) from retrieval/search bots (fetch content
// on-demand to answer user questions, similar to traditional search).
const AI_BOTS: { name: string; purpose: 'training' | 'retrieval' | 'search' | 'mixed'; vendor: string }[] = [
  { name: 'GPTBot', purpose: 'training', vendor: 'OpenAI' },
  { name: 'ChatGPT-User', purpose: 'retrieval', vendor: 'OpenAI' },
  { name: 'OAI-SearchBot', purpose: 'search', vendor: 'OpenAI' },
  { name: 'ClaudeBot', purpose: 'mixed', vendor: 'Anthropic' },
  { name: 'anthropic-ai', purpose: 'training', vendor: 'Anthropic (legacy)' },
  { name: 'Claude-Web', purpose: 'retrieval', vendor: 'Anthropic (legacy)' },
  { name: 'PerplexityBot', purpose: 'search', vendor: 'Perplexity' },
  { name: 'Perplexity-User', purpose: 'retrieval', vendor: 'Perplexity' },
  { name: 'Google-Extended', purpose: 'training', vendor: 'Google (Gemini)' },
  { name: 'Applebot-Extended', purpose: 'training', vendor: 'Apple' },
  { name: 'CCBot', purpose: 'training', vendor: 'Common Crawl' },
  { name: 'Bytespider', purpose: 'training', vendor: 'ByteDance' },
  { name: 'Meta-ExternalAgent', purpose: 'training', vendor: 'Meta' },
  { name: 'cohere-ai', purpose: 'training', vendor: 'Cohere' },
  { name: 'Diffbot', purpose: 'mixed', vendor: 'Diffbot' },
];

export interface RobotsGroup {
  agents: string[];
  disallows: string[];
  allows: string[];
}

export function parseRobotsTxt(content: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) { lastWasAgent = false; continue; }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) { lastWasAgent = false; continue; }

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [value], disallows: [], allows: [] };
        groups.push(current);
      } else {
        current.agents.push(value);
      }
      lastWasAgent = true;
    } else if (current && directive === 'disallow') {
      current.disallows.push(value);
      lastWasAgent = false;
    } else if (current && directive === 'allow') {
      current.allows.push(value);
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function botStatusFromGroups(groups: RobotsGroup[], botName: string): AIBotStatus {
  // Look for a group whose agents match the bot name exactly (case-insensitive).
  const matching = groups.filter(g => g.agents.some(a => a.toLowerCase() === botName.toLowerCase()));
  if (matching.length === 0) return 'unspecified';

  // Combine all rules from matching groups.
  const disallows = matching.flatMap(g => g.disallows);
  const allows = matching.flatMap(g => g.allows);

  const fullBlock = disallows.some(d => d === '/' || d === '/*');
  const emptyDisallow = disallows.some(d => d === '');
  const rootAllow = allows.some(a => a === '/' || a === '/*');

  if (fullBlock && !rootAllow) return 'blocked';
  if (disallows.length === 0 || emptyDisallow) return 'allowed';
  if (disallows.length > 0) return 'partial';
  return 'allowed';
}

export async function checkAIReadiness(baseUrl: string, robotsContent?: string): Promise<AIReadinessInfo> {
  try {
    const origin = new URL(baseUrl).origin;

    // Parse robots.txt rules if content was provided
    let groups: RobotsGroup[] = [];
    if (robotsContent) groups = parseRobotsTxt(robotsContent);

    // Check if wildcard blocks everything (affects AI bots that rely on *)
    const wildcardGroup = groups.find(g => g.agents.some(a => a === '*'));
    const wildcardBlocksAll = !!wildcardGroup && wildcardGroup.disallows.includes('/') && !wildcardGroup.allows.includes('/');

    const bots: AIBotRule[] = AI_BOTS.map(b => {
      let status = botStatusFromGroups(groups, b.name);
      // If unspecified and wildcard blocks all, the bot is effectively blocked.
      if (status === 'unspecified' && wildcardBlocksAll) status = 'blocked';
      return { bot: b.name, purpose: b.purpose, vendor: b.vendor, status };
    });

    // Check llms.txt and llms-full.txt
    let hasLlmsTxt = false;
    let hasLlmsFullTxt = false;
    let llmsTxtUrl: string | undefined;
    try {
      const r = await fetch(`${origin}/llms.txt`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        hasLlmsTxt = true;
        llmsTxtUrl = `${origin}/llms.txt`;
      }
    } catch {}
    try {
      const r = await fetch(`${origin}/llms-full.txt`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) hasLlmsFullTxt = true;
    } catch {}

    return { bots, hasLlmsTxt, hasLlmsFullTxt, llmsTxtUrl, wildcardBlocksAll };
  } catch (err) {
    return { bots: [], hasLlmsTxt: false, hasLlmsFullTxt: false, wildcardBlocksAll: false, error: String(err) };
  }
}

// ============================================================
//  SITEMAP PARSER (urlset + sitemapindex)
// ============================================================
// Cap total URLs to something sane to protect the audit from
// runaway sitemap indexes on very large sites.
const MAX_SITEMAP_URLS = 5000;
const MAX_SUB_SITEMAPS = 20;

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTag(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodeXmlEntities(m[1].trim()) : undefined;
}

function parseUrlSetBlock(xml: string): SitemapUrlEntry[] {
  const out: SitemapUrlEntry[] = [];
  const urlBlocks = xml.match(/<url\b[^>]*>[\s\S]*?<\/url>/gi) || [];
  for (const block of urlBlocks) {
    const loc = extractTag(block, 'loc');
    if (!loc) continue;
    const lastmod = extractTag(block, 'lastmod');
    const changefreq = extractTag(block, 'changefreq');
    const priorityStr = extractTag(block, 'priority');
    const priority = priorityStr ? parseFloat(priorityStr) : undefined;
    const imageMatches = block.match(/<image:image\b/gi) || [];
    out.push({
      url: loc,
      lastmod,
      changefreq,
      priority: priority !== undefined && !Number.isNaN(priority) ? priority : undefined,
      imageCount: imageMatches.length,
    });
    if (out.length >= MAX_SITEMAP_URLS) break;
  }
  return out;
}

function parseSitemapIndexBlock(xml: string): string[] {
  const out: string[] = [];
  const blocks = xml.match(/<sitemap\b[^>]*>[\s\S]*?<\/sitemap>/gi) || [];
  for (const block of blocks) {
    const loc = extractTag(block, 'loc');
    if (loc) out.push(loc);
    if (out.length >= MAX_SUB_SITEMAPS) break;
  }
  return out;
}

async function fetchSitemapXml(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return undefined;
    return await r.text();
  } catch {
    return undefined;
  }
}

export async function fetchSitemap(sitemapUrl: string): Promise<SitemapInfo> {
  try {
    const xml = await fetchSitemapXml(sitemapUrl);
    if (!xml) {
      return { urls: [], sitemapUrl, isIndex: false, subSitemaps: [], error: 'Could not fetch sitemap' };
    }

    // Detect type
    if (/<sitemapindex\b/i.test(xml)) {
      const subs = parseSitemapIndexBlock(xml);
      const allUrls: SitemapUrlEntry[] = [];
      for (const sub of subs) {
        if (allUrls.length >= MAX_SITEMAP_URLS) break;
        const subXml = await fetchSitemapXml(sub);
        if (!subXml) continue;
        const entries = parseUrlSetBlock(subXml);
        for (const e of entries) {
          if (allUrls.length >= MAX_SITEMAP_URLS) break;
          allUrls.push(e);
        }
      }
      return { urls: allUrls, sitemapUrl, isIndex: true, subSitemaps: subs };
    }

    if (/<urlset\b/i.test(xml)) {
      const urls = parseUrlSetBlock(xml);
      return { urls, sitemapUrl, isIndex: false, subSitemaps: [] };
    }

    return { urls: [], sitemapUrl, isIndex: false, subSitemaps: [], error: 'Unknown sitemap format' };
  } catch (err) {
    return { urls: [], sitemapUrl, isIndex: false, subSitemaps: [], error: String(err) };
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
