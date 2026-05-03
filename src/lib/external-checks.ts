import type {
  SSLInfo, DNSInfo, PageSpeedData, SafeBrowsingData,
  SecurityHeadersInfo, AIReadinessInfo, AIBotRule, AIBotStatus,
  SitemapInfo, SitemapUrlEntry, WwwConsistencyInfo,
} from '@/types';
import { promises as dns } from 'dns';

// Shared header builder for the audit's HTTP probes. The crawler has
// its own (slightly richer) version because it also sets Accept /
// Accept-Language; the probes here only need UA + optional auth +
// any user-supplied custom headers (which override the built-ins).
function probeHeaders(
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

// ============================================================
//  SSL CHECK via SSL Labs API (no key required)
// ============================================================
// Polling budget: SSL Labs typically completes in 60-120s for a fresh
// scan, but cold-cache cases (or sites with many endpoints) can run
// up to ~3 minutes. We poll every 10s for at most 180s, then fall
// back to a minimal HTTPS reachability probe and surface pendingSlow
// so the UI renders a neutral "scan still running" hint instead of
// a misleading "unknown" or red error.
//
// Async architecture: the route handler kicks off checkSSL early and
// awaits its promise just before findings generation, so the polling
// runs in parallel with the crawl / sitemap / PSI steps — the worst-
// case 180s polling budget no longer adds 180s to total audit time.
const SSL_POLL_INTERVAL_MS = 10_000;
const SSL_POLL_TIMEOUT_MS = 180_000;

// SSL Labs grades from best to worst. T = cert untrusted, M = name
// mismatch — both are clear failures. F is the worst valid letter
// grade (still cryptographically broken, but at least the cert chain
// validates). Used to pick the worst-case grade across multi-endpoint
// scans (large sites often have separate IPv4/IPv6 endpoints).
const SSL_GRADE_RANK: Record<string, number> = {
  'A+': 0, 'A': 1, 'A-': 2,
  'B': 3,
  'C': 4,
  'D': 5,
  'E': 6,
  'F': 7,
  'T': 8,
  'M': 9,
};

function worstGrade(grades: Array<string | undefined>): string | undefined {
  const valid = grades.filter((g): g is string => typeof g === 'string' && g in SSL_GRADE_RANK);
  if (valid.length === 0) {
    // No ranked grade — fall back to the first non-empty value so the
    // UI still has something to show (e.g. unranked "Z" or transitional
    // grades SSL Labs occasionally returns).
    return grades.find((g): g is string => typeof g === 'string' && g.length > 0);
  }
  return valid.reduce((worst, g) => (SSL_GRADE_RANK[g] > SSL_GRADE_RANK[worst] ? g : worst));
}

interface SSLLabsEndpoint {
  grade?: string;
  details?: {
    cert?: { notAfter?: number; issuerSubject?: string };
    protocols?: Array<{ name: string; version: string }>;
  };
}

interface SSLLabsResponse {
  status?: 'DNS' | 'IN_PROGRESS' | 'READY' | 'ERROR';
  statusMessage?: string;
  endpoints?: SSLLabsEndpoint[];
}

async function fallbackHttpsProbe(domain: string): Promise<boolean> {
  try {
    const r = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(8000), redirect: 'follow' });
    return r.ok;
  } catch {
    return false;
  }
}

export async function checkSSL(domain: string): Promise<SSLInfo> {
  try {
    // Kick off a fresh analysis. The triggering call returns the
    // current status (DNS / IN_PROGRESS) immediately — we don't need
    // its body, just need to side-effect the queue submission.
    const triggerUrl = `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&startNew=on&all=done`;
    await fetch(triggerUrl, { signal: AbortSignal.timeout(10_000) });

    const pollUrl = `https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(domain)}&all=done`;
    const deadline = Date.now() + SSL_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, SSL_POLL_INTERVAL_MS));

      let data: SSLLabsResponse | null = null;
      try {
        const resp = await fetch(pollUrl, { signal: AbortSignal.timeout(10_000) });
        if (resp.ok) {
          data = (await resp.json()) as SSLLabsResponse;
        }
      } catch {
        // Network blip on a single poll — continue, don't fail the whole scan.
        continue;
      }
      if (!data) continue;

      if (data.status === 'READY' && data.endpoints && data.endpoints.length > 0) {
        const grade = worstGrade(data.endpoints.map(e => e.grade));
        // Pull cert details from the first endpoint with a cert — they
        // share a cert in the common case (multi-IP behind one host).
        const certEp = data.endpoints.find(e => e.details?.cert);
        const cert = certEp?.details?.cert;
        const expiresMs = cert?.notAfter;
        const expiresAt = expiresMs ? new Date(expiresMs).toISOString() : undefined;
        const daysUntilExpiry = expiresMs
          ? Math.floor((expiresMs - Date.now()) / 86400000)
          : undefined;
        return {
          valid: !!grade && grade !== 'T' && grade !== 'M' && grade !== 'F',
          grade,
          issuer: cert?.issuerSubject,
          expiresAt,
          daysUntilExpiry,
          protocols: certEp?.details?.protocols?.map(p => `${p.name} ${p.version}`),
        };
      }

      if (data.status === 'ERROR') {
        // Hard fail from SSL Labs — surface the API's own error text
        // so the UI can show why (e.g. "Unable to resolve domain
        // name", "Server's certificate doesn't match its hostname").
        const valid = await fallbackHttpsProbe(domain);
        return {
          valid,
          error: data.statusMessage || 'SSL Labs reported ERROR',
        };
      }
      // status === 'DNS' or 'IN_PROGRESS' → keep polling.
    }

    // 180s exhausted, scan still running. Fall back to a basic HTTPS
    // probe so the audit still has a valid/invalid signal, and flag
    // pendingSlow so the UI shows the neutral "re-audit later" hint
    // instead of treating this as an error.
    const valid = await fallbackHttpsProbe(domain);
    return { valid, pendingSlow: true };
  } catch (err) {
    // Trigger call itself blew up (DNS, network) — fall back without
    // a grade and don't mark pendingSlow (this isn't a slow scan, it's
    // a hard failure to reach SSL Labs).
    const valid = await fallbackHttpsProbe(domain);
    if (valid) return { valid };
    return { valid: false, error: String(err) };
  }
}

// ============================================================
//  DNS CHECK (SPF, DKIM, DMARC, MX)
// ============================================================

// Common DKIM selectors used across mail providers. Order is "more
// likely first" so the typical case short-circuits early. Coverage:
//   - Generic / legacy:                   default, mail, dkim, k1
//   - M365 (catch-all selectors):         selector1, selector2
//   - Google Workspace:                    google
//   - SendGrid / Mailgun / Mailjet /
//     Mandrill / Zoho / Protonmail /
//     AWS SES / Mimecast / Fastmail /
//     M365 EOP / generic numeric          (as listed below)
//
// M365 also injects a domain-derived selector pair
// (selector1-<slug>, selector2-<slug>) which is computed at probe time
// from the domain. Combined coverage handles the common case (~70%
// of business mail setups) but still cannot exhaustively guess every
// custom selector — non-detection is therefore reported as a detection
// limitation, not as a configuration defect (see findings/tech.ts).
const DKIM_STATIC_SELECTORS = [
  'default', 'mail', 'dkim', 'k1',
  'selector1', 'selector2',
  'google',
  's1', 's2',
  'mailgun', 'mg', 'pic', 'smtpapi',
  'mailjet',
  'mandrill',
  'zoho',
  'protonmail', 'protonmail2', 'protonmail3',
  'amazonses',
  'mimecast',
  'fm1', 'fm2', 'fm3',
  'mxvault',
  'sel1', 'sel2', 'key1', 'key2',
] as const;

interface DkimProbeResult {
  found: boolean;
  selector?: string;
  record?: string;
  attemptedSelectors: string[];
}

async function probeDkim(domain: string): Promise<DkimProbeResult> {
  // M365 derives selectors from the domain by replacing every dot with
  // a hyphen — e.g. example.com → selector1-example-com.
  const slug = domain.replace(/\./g, '-');
  const allSelectors: string[] = [...DKIM_STATIC_SELECTORS, `selector1-${slug}`, `selector2-${slug}`];

  for (const selector of allSelectors) {
    try {
      const records = await dns.resolveTxt(`${selector}._domainkey.${domain}`);
      if (records.length === 0) continue;
      // TXT records can be split into 255-byte chunks; join all parts
      // back into the canonical single string.
      const joined = records[0].join('');
      // Validate it actually looks like DKIM. A bare existing TXT under
      // the _domainkey label is sometimes a CNAME-pointing placeholder
      // or unrelated metadata — treat only records carrying a DKIM
      // marker (v=DKIM1, or the k=/p= tag pair) as matches.
      if (!/v=DKIM1|k=|p=/i.test(joined)) continue;
      return {
        found: true,
        selector,
        record: joined,
        attemptedSelectors: allSelectors.slice(0, allSelectors.indexOf(selector) + 1),
      };
    } catch {
      // NXDOMAIN / no answer — try the next selector.
    }
  }
  return { found: false, attemptedSelectors: allSelectors };
}

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

    // DKIM via extended selector probe + M365 dynamic selectors.
    const dkim = await probeDkim(domain);

    // MX
    let mxRecords: string[] = [];
    try {
      const mx = await dns.resolveMx(domain);
      mxRecords = mx.map(r => r.exchange).slice(0, 5);
    } catch {}

    return {
      hasSPF,
      hasDKIM: dkim.found,
      hasDMARC,
      spfRecord,
      dmarcRecord,
      dkimSelector: dkim.selector,
      dkimRecord: dkim.record,
      mxRecords,
    };
  } catch (err) {
    return { hasSPF: false, hasDKIM: false, hasDMARC: false, error: String(err) };
  }
}

// ============================================================
//  PAGESPEED INSIGHTS API
// ============================================================
// Single PSI run — one HTTP call, one Lighthouse execution. Kept
// as a private helper so checkPageSpeed can average multiple runs.
async function runSinglePageSpeedCheck(url: string, apiKey: string): Promise<PageSpeedData> {
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

    // LCP element — Lighthouse's "largest-contentful-paint-element" audit
    // points at the specific DOM node that triggered the LCP measurement.
    // Knowing whether it's a hero image vs. a paragraph vs. a video makes
    // the recommendation actionable; we also keep the raw snippet so the
    // finding can do follow-up analysis (lazy-loaded hero, missing
    // fetchpriority, etc.).
    let lcpElement: PageSpeedData['lcpElement'] | undefined;
    const lcpItem = audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.node;
    if (lcpItem && typeof lcpItem.selector === 'string' && typeof lcpItem.snippet === 'string') {
      lcpElement = {
        selector: lcpItem.selector,
        snippet: lcpItem.snippet,
        nodeLabel: typeof lcpItem.nodeLabel === 'string' ? lcpItem.nodeLabel : undefined,
      };
    }

    // CrUX field-data metrics — read from loadingExperience.metrics.
    // We deliberately do NOT fall back to lab values for any of these
    // (LCP, CLS, FCP, INP, TTFB, FID-field). Lab measurements come
    // from a Google datacenter adjacent to the origin and routinely
    // return numbers that misrepresent end-user experience (e.g. TTFB
    // 3ms for any CDN-fronted site). When a metric is missing from
    // CrUX the renderer shows "not available (insufficient real-user
    // data)" instead — see PsiMetricSource in @/types.
    //
    // Unit notes: LCP/FCP/INP/TTFB/FID percentiles are already in ms.
    // CLS is stored as integer × 100 (so 5 means 0.05) — divide here
    // so consumers compare against the canonical decimal threshold.
    const cruxLcp = cruxMetrics?.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
    const cruxFcp = cruxMetrics?.FIRST_CONTENTFUL_PAINT_MS?.percentile;
    const cruxClsRaw = cruxMetrics?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;
    const cruxInp = cruxMetrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile;
    const cruxTtfb = cruxMetrics?.EXPERIMENTAL_TIME_TO_FIRST_BYTE?.percentile;
    const cruxFid = cruxMetrics?.FIRST_INPUT_DELAY_MS?.percentile;

    const lcp = typeof cruxLcp === 'number' ? cruxLcp : undefined;
    const fcp = typeof cruxFcp === 'number' ? cruxFcp : undefined;
    const cls = typeof cruxClsRaw === 'number' ? cruxClsRaw / 100 : undefined;
    const inp = typeof cruxInp === 'number' ? cruxInp : undefined;
    const ttfb = typeof cruxTtfb === 'number' ? cruxTtfb : undefined;
    const fidField = typeof cruxFid === 'number' ? cruxFid : undefined;

    return {
      performanceScore: cats?.performance?.score != null ? Math.round(cats.performance.score * 100) : undefined,
      accessibilityScore: cats?.accessibility?.score != null ? Math.round(cats.accessibility.score * 100) : undefined,
      seoScore: cats?.seo?.score != null ? Math.round(cats.seo.score * 100) : undefined,
      bestPracticesScore: cats?.['best-practices']?.score != null ? Math.round(cats['best-practices'].score * 100) : undefined,
      lcp,
      lcpSource: lcp !== undefined ? 'field' : 'unavailable',
      cls,
      clsSource: cls !== undefined ? 'field' : 'unavailable',
      fcp,
      fcpSource: fcp !== undefined ? 'field' : 'unavailable',
      inp,
      inpSource: inp !== undefined ? 'field' : 'unavailable',
      ttfb,
      ttfbSource: ttfb !== undefined ? 'field' : 'unavailable',
      fidField,
      fidFieldSource: fidField !== undefined ? 'field' : 'unavailable',
      // Lab-only metrics — always present when PSI ran successfully.
      fid: audits?.['max-potential-fid']?.numericValue,
      si: audits?.['speed-index']?.numericValue,
      tbt: audits?.['total-blocking-time']?.numericValue,
      structuredDataAuditWarning,
      lcpElement,
    };
  } catch (err) {
    return { error: String(err) };
  }
}

// Average defined numeric values across runs; return undefined if none are defined.
function avgDefined(values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  if (defined.length === 0) return undefined;
  return defined.reduce((a, b) => a + b, 0) / defined.length;
}

// Aggregate multiple PSI runs by averaging numeric fields. Scores are
// rounded back to integers (Lighthouse convention). Raw timings and
// ratios stay at full precision. The structured-data warning and LCP
// element are taken from the first run — they're deterministic for
// the same page.
function aggregatePageSpeedRuns(runs: PageSpeedData[]): PageSpeedData {
  const round = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  // Source flags are deterministic across same-day runs (CrUX coverage
  // doesn't flip between two PSI calls a few seconds apart). Take from
  // the first run so the aggregated PageSpeedData carries the same
  // source semantics consumers see for single-run audits.
  const first = runs[0];
  return {
    performanceScore: round(avgDefined(runs.map(r => r.performanceScore))),
    accessibilityScore: round(avgDefined(runs.map(r => r.accessibilityScore))),
    seoScore: round(avgDefined(runs.map(r => r.seoScore))),
    bestPracticesScore: round(avgDefined(runs.map(r => r.bestPracticesScore))),
    // CrUX field metrics — averaging is a no-op (identical across same-day
    // runs) but keeps the code shape uniform. Source preserved from run 1.
    lcp: avgDefined(runs.map(r => r.lcp)),
    lcpSource: first?.lcpSource,
    cls: avgDefined(runs.map(r => r.cls)),
    clsSource: first?.clsSource,
    inp: avgDefined(runs.map(r => r.inp)),
    inpSource: first?.inpSource,
    fidField: avgDefined(runs.map(r => r.fidField)),
    fidFieldSource: first?.fidFieldSource,
    ttfb: avgDefined(runs.map(r => r.ttfb)),
    ttfbSource: first?.ttfbSource,
    fcp: avgDefined(runs.map(r => r.fcp)),
    fcpSource: first?.fcpSource,
    // Lab-only metrics
    fid: avgDefined(runs.map(r => r.fid)),
    si: avgDefined(runs.map(r => r.si)),
    tbt: avgDefined(runs.map(r => r.tbt)),
    structuredDataAuditWarning: runs[0]?.structuredDataAuditWarning,
    lcpElement: runs[0]?.lcpElement,
  };
}

// Public entry point. When runs >= 2 the PSI endpoint is hit multiple
// times sequentially (with a short gap to be polite to rate limits)
// and the numeric metrics are averaged to smooth out the ±3-7 point
// variance Google openly documents for Lighthouse.
export async function checkPageSpeed(
  url: string,
  apiKey: string,
  runs: number = 1,
  onRun?: (runNumber: number, totalRuns: number) => void
): Promise<PageSpeedData> {
  const effectiveRuns = Math.max(1, Math.floor(runs));
  const results: PageSpeedData[] = [];

  for (let i = 0; i < effectiveRuns; i++) {
    if (i > 0) {
      // 1s pause between runs to avoid hitting the per-second PSI quota
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    onRun?.(i + 1, effectiveRuns);
    const single = await runSinglePageSpeedCheck(url, apiKey);
    // If any run errors, bail out immediately — averaging partial data
    // would be worse than a single-run result.
    if (single.error) return single;
    results.push(single);
  }

  if (results.length === 1) return results[0];
  return aggregatePageSpeedRuns(results);
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
//  WWW / NON-WWW CONSISTENCY CHECK
// ============================================================
// Both the www and the bare host should redirect to the same canonical
// variant. We fetch both with redirect: 'follow' and compare the final
// URLs (trailing slash normalised).
export async function checkWwwConsistency(
  url: string,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<WwwConsistencyInfo> {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isWww = host.startsWith('www.');
    const variantHost = isWww ? host.slice(4) : `www.${host}`;
    const variantUrl = `${parsed.protocol}//${variantHost}${parsed.pathname}${parsed.search}`;
    const headers = probeHeaders(userAgent, authHeader, customHeaders);

    const fetchFinal = async (target: string): Promise<string | undefined> => {
      try {
        const resp = await fetch(target, {
          method: 'GET',
          redirect: 'follow',
          headers,
          signal: AbortSignal.timeout(8000),
        });
        return resp.url || undefined;
      } catch {
        return undefined;
      }
    };

    const [canonicalFinalUrl, variantFinalUrl] = await Promise.all([
      fetchFinal(url),
      fetchFinal(variantUrl),
    ]);

    if (!canonicalFinalUrl || !variantFinalUrl) {
      return {
        canonicalUrl: url,
        variantUrl,
        canonicalFinalUrl,
        variantFinalUrl,
        consistent: true,
        error: 'one or both variants unreachable',
      };
    }

    const normalise = (u: string) => u.replace(/\/$/, '').toLowerCase();
    const consistent = normalise(canonicalFinalUrl) === normalise(variantFinalUrl);

    return {
      canonicalUrl: url,
      variantUrl,
      canonicalFinalUrl,
      variantFinalUrl,
      consistent,
    };
  } catch (err) {
    return {
      canonicalUrl: url,
      variantUrl: url,
      consistent: true,
      error: String(err),
    };
  }
}

// ============================================================
//  SECURITY HEADERS CHECK
// ============================================================
export async function checkSecurityHeaders(
  url: string,
  html?: string,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<SecurityHeadersInfo> {
  try {
    // Use GET (not HEAD) because some servers handle HEAD differently
    // and we want the exact headers a real browser would see.
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: probeHeaders(userAgent, authHeader, customHeaders),
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

export async function checkAIReadiness(
  baseUrl: string,
  robotsContent?: string,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<AIReadinessInfo> {
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
    const headers = probeHeaders(userAgent, authHeader, customHeaders);
    let hasLlmsTxt = false;
    let hasLlmsFullTxt = false;
    let llmsTxtUrl: string | undefined;
    try {
      const r = await fetch(`${origin}/llms.txt`, { headers, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        hasLlmsTxt = true;
        llmsTxtUrl = `${origin}/llms.txt`;
      }
    } catch {}
    try {
      const r = await fetch(`${origin}/llms-full.txt`, { headers, signal: AbortSignal.timeout(8000) });
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

async function fetchSitemapXml(
  url: string,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<string | undefined> {
  try {
    const r = await fetch(url, {
      headers: probeHeaders(userAgent, authHeader, customHeaders),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return undefined;
    return await r.text();
  } catch {
    return undefined;
  }
}

export async function fetchSitemap(
  sitemapUrl: string,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<SitemapInfo> {
  try {
    const xml = await fetchSitemapXml(sitemapUrl, userAgent, authHeader, customHeaders);
    if (!xml) {
      return { urls: [], sitemapUrl, isIndex: false, subSitemaps: [], error: 'Could not fetch sitemap' };
    }

    // Detect type
    if (/<sitemapindex\b/i.test(xml)) {
      const subs = parseSitemapIndexBlock(xml);
      const allUrls: SitemapUrlEntry[] = [];
      for (const sub of subs) {
        if (allUrls.length >= MAX_SITEMAP_URLS) break;
        const subXml = await fetchSitemapXml(sub, userAgent, authHeader, customHeaders);
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
export async function checkRobotsAndSitemap(
  baseUrl: string,
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<{
  hasRobots: boolean;
  hasSitemap: boolean;
  robotsContent?: string;
  sitemapUrl?: string;
}> {
  const origin = new URL(baseUrl).origin;
  const headers = probeHeaders(userAgent, authHeader, customHeaders);
  let hasRobots = false;
  let hasSitemap = false;
  let robotsContent: string | undefined;
  let sitemapUrl: string | undefined;

  // Check robots.txt
  try {
    const r = await fetch(`${origin}/robots.txt`, { headers, signal: AbortSignal.timeout(8000) });
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
      const r = await fetch(`${origin}/sitemap.xml`, { headers, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        hasSitemap = true;
        if (!sitemapUrl) sitemapUrl = `${origin}/sitemap.xml`;
      }
    } catch {}
  }

  // Also check sitemap_index.xml
  if (!hasSitemap) {
    try {
      const r = await fetch(`${origin}/sitemap_index.xml`, { headers, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        hasSitemap = true;
        if (!sitemapUrl) sitemapUrl = `${origin}/sitemap_index.xml`;
      }
    } catch {}
  }

  return { hasRobots, hasSitemap, robotsContent, sitemapUrl };
}
