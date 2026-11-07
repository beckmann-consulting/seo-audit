// One run of the public free check (websites-27, POST /api/widget/check):
// the start page of a domain and the legal pages it links to (at most 5
// pages), seven modules, the three most important findings. Everything the
// run fetches from the checked site goes through safe-fetch (only the
// checked host and its www or apex counterpart, only public addresses,
// pinned), on a transport that ends every request and DNS question when the
// run's signal aborts. No SSL Labs, no DNS records, no Browserless.

import { crawlSite } from '@/lib/crawler';
import { extractPageSEO } from '@/lib/extractor';
import {
  checkPageSpeed, parseSitemapIndexBlock, parseUrlSetBlock, securityHeadersFrom,
} from '@/lib/external-checks';
import {
  calculateModuleScore, generateContentFindings, generateFaviconFindings, generateFontLoadingFindings,
  generateImageDetailFindings, generateInsecureLinkFindings, generateLegalFindings, generateOpenGraphFindings,
  generatePerformanceFindings, generateRedirectFindings, generateSecurityHeadersFindings, generateSEOFindings,
  generateStructuredDataFindings, generateTechFindings, generateThirdPartyScriptFindings, generateTouchTargetFindings,
  generateUXFindings, getTopFindings,
} from '@/lib/findings-engine';
import { evaluateAIVisibility, weightedTotal } from '@/lib/ai-visibility';
import { classifyLlmsTxt, LLMS_MAX_BYTES } from '@/lib/ai-visibility/llms';
import {
  buildScope, DEFAULT_LIMITS, safeFetch, type Budget, type Limits, type SafeResult, type Scope, type Transport,
} from '@/lib/ai-visibility/safe-fetch';
import {
  COOKIE_URL_PATTERNS, detectLegalPages, IMPRINT_URL_PATTERNS, pathMatchesAny, PRIVACY_URL_PATTERNS, TERMS_URL_PATTERNS,
} from '@/lib/util/legal-page-detection';
import type { LlmsTxtInfo, RobotsFetch } from '@/lib/ai-visibility/types';
import type { RenderResult, Renderer } from '@/lib/renderer/types';
import type { CrawlClassification } from '@/lib/util/crawl-classifier';
import type { CrawlStats, Finding, Module, PageData, PageSpeedData, SitemapInfo } from '@/types';

/** The seven areas the check shows (Tobias, 07.11.): no offers, no accessibility. */
export const CHECK_MODULES: Module[] = ['seo', 'content', 'legal', 'ux', 'tech', 'performance', 'ai'];

export const CHECK_LABELS: Record<string, { de: string; en: string }> = {
  seo: { de: 'SEO', en: 'SEO' },
  content: { de: 'Inhalte', en: 'Content' },
  legal: { de: 'Rechtliche Basisangaben', en: 'Basic legal information' },
  ux: { de: 'Nutzerführung', en: 'Usability' },
  tech: { de: 'Technik', en: 'Technology' },
  performance: { de: 'Ladezeit', en: 'Loading speed' },
  ai: { de: 'KI-Sichtbarkeit', en: 'AI visibility' },
};

export const MAX_PAGES = 5;
export const USER_AGENT = 'Mozilla/5.0 (compatible; BeckmannDigitalCheck/1.0; +https://beckmanndigital.com/en/seo-check)';
const RUN_BYTES = 12 * 1024 * 1024;

/** The answer of the API, in one language. */
export interface CheckResult {
  host: string;
  score: number;
  modules: { module: Module; label: string; score: number }[];
  findings: { title: string; text: string }[];
  pages: number;
  performanceMeasured: boolean;
  checkedAt: string;
}

/**
 * What a run measured, in both languages (Prüfer-224): the cache keeps this
 * per host, so German and English share one run and one PageSpeed call.
 */
export interface CheckMeasurement {
  host: string;
  score: number;
  modules: { module: Module; score: number }[];
  findings: { de: { title: string; text: string }; en: { title: string; text: string } }[];
  pages: number;
  performanceMeasured: boolean;
  checkedAt: string;
}

/** The measurement as the API answers it in one language. */
export function inLanguage(m: CheckMeasurement, lang: 'de' | 'en'): CheckResult {
  return {
    host: m.host,
    score: m.score,
    modules: m.modules.map(x => ({ module: x.module, label: CHECK_LABELS[x.module][lang], score: x.score })),
    findings: m.findings.map(f => f[lang]),
    pages: m.pages,
    performanceMeasured: m.performanceMeasured,
    checkedAt: m.checkedAt,
  };
}

export type CheckOutcome =
  | { ok: true; result: CheckMeasurement }
  | { ok: false; error: 'unreachable' | 'refused' | 'timeout' };

export interface RunOptions {
  signal: AbortSignal; // aborted at the run's deadline
  deadline: number; // epoch ms, the same moment
  transport: Transport;
  pageSpeedKey?: string;
  limits?: Limits;
}

/** A hostname as typed by a visitor, or null: no scheme or path needed, no IP, no port, no credentials. */
export function normaliseHost(input: string): string | null {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s || s.length > 300) return null;
  if (!/^https?:\/\//.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.replace(/\.$/, '');
  if (host.length > 253 || !host.includes('.')) return null;
  if (/^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[')) return null; // no IP literals
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}

/** A renderer that fetches through safe-fetch within the run's scope, budget and signal. */
export class SafeRenderer implements Renderer {
  readonly mode = 'static' as const;
  /** Response headers by final URL: crawlSite keeps only some of them in PageData. */
  readonly headersByUrl = new Map<string, Record<string, string>>();
  constructor(private readonly o: { scope: Scope; transport: Transport; limits: Limits; budget: Budget; signal: AbortSignal }) {}

  async fetch(url: string): Promise<RenderResult> {
    const started = Date.now();
    const empty: RenderResult = {
      url, finalUrl: url, status: 0, headers: {}, html: '', redirectChain: [], loopDetected: false,
      loadTimeMs: 0, protocol: null, mode: 'static',
    };
    if (this.o.signal.aborted) return empty;
    const r = await safeFetch(url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'de,en;q=0.9' },
    }, { scope: this.o.scope, transport: this.o.transport, limits: this.o.limits, budget: this.o.budget, document: true });
    if (!r.ok) return { ...empty, loadTimeMs: Date.now() - started };
    this.headersByUrl.set(r.res.finalUrl, r.res.headers);
    const alt = `${r.res.headers['alt-svc'] ?? ''} ${r.res.headers['via'] ?? ''}`;
    return {
      url,
      finalUrl: r.res.finalUrl,
      status: r.res.status,
      contentType: r.res.headers['content-type'],
      headers: r.res.headers,
      html: r.res.body.toString('utf8'),
      redirectChain: r.res.finalUrl !== url ? [url] : [],
      loopDetected: false,
      loadTimeMs: Date.now() - started,
      protocol: /h2|h3|HTTP\/2|HTTP\/3/i.test(alt) ? 'h2' : null,
      mode: 'static',
    };
  }

  async close(): Promise<void> {}
}

/**
 * How the public routes classify a page whose rendering or link parsing
 * threw: without any request (the default classifier would HEAD-probe it
 * with the global fetch, outside safe-fetch).
 */
export const classifyWithoutNetwork = async (_url: string, reason: string): Promise<CrawlClassification> =>
  ({ bucket: 'renderFailed', reason });

function emptyStats(): CrawlStats {
  return { totalPages: 0, crawledPages: 0, brokenLinks: [], redirectChains: [], externalLinks: 0, httpErrors: [], unreachable: [], renderFailed: [] };
}

function mergeStats(a: CrawlStats, b: CrawlStats): CrawlStats {
  return {
    totalPages: a.totalPages + b.totalPages,
    crawledPages: a.crawledPages + b.crawledPages,
    brokenLinks: [...a.brokenLinks, ...b.brokenLinks],
    redirectChains: [...a.redirectChains, ...b.redirectChains],
    externalLinks: a.externalLinks + b.externalLinks,
    httpErrors: [...a.httpErrors, ...b.httpErrors],
    unreachable: [...a.unreachable, ...b.unreachable],
    renderFailed: [...a.renderFailed, ...b.renderFailed],
  };
}

/**
 * beckmanndigital.com shows no em or en dash (websites-27, part 0): a range
 * between numbers gets a hyphen, any other dash a comma.
 */
export function withoutDashes(text: string): string {
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, '$1-$2')
    .replace(/\s*[\u2013\u2014]\s*/g, ', ')
    .replace(/,\s*([.,;:])/g, '$1');
}

/** One finding in plain words: its title, and its recommendation as the second sentence. */
function plain(f: Finding, lang: 'de' | 'en'): { title: string; text: string } {
  const title = (lang === 'de' ? f.title_de : f.title_en).replace(/^(Heuristik|Heuristic):\s*/, '');
  const text = (lang === 'de' ? f.recommendation_de : f.recommendation_en) || (lang === 'de' ? f.description_de : f.description_en);
  return { title: withoutDashes(title), text: withoutDashes(text) };
}

export type SafeGet = (url: string, document?: boolean, accept?: string) => Promise<SafeResult>;

/** robots.txt and the sitemap it names (or /sitemap.xml) of one origin, fetched with `get` (safe-fetch). */
export async function robotsAndSitemap(origin: string, get: SafeGet): Promise<{ robots: RobotsFetch; sitemap?: SitemapInfo }> {
  let robots: RobotsFetch;
  let sitemapUrl: string | undefined;
  const rr = await get(`${origin}/robots.txt`, true, 'text/plain');
  if (!rr.ok) robots = { status: 'network-error', error: rr.reason };
  else if (rr.res.status >= 200 && rr.res.status < 300) {
    const content = rr.res.body.toString('utf8');
    robots = { status: 'ok', httpStatus: rr.res.status, content };
    sitemapUrl = content.match(/Sitemap:\s*(\S+)/i)?.[1];
  } else robots = { status: rr.res.status >= 500 ? 'server-error' : 'not-found', httpStatus: rr.res.status };

  let sitemap: SitemapInfo | undefined;
  const url = sitemapUrl ?? `${origin}/sitemap.xml`;
  const sm = await get(url, true, 'application/xml');
  if (sm.ok && sm.res.status >= 200 && sm.res.status < 300) {
    const xml = sm.res.body.toString('utf8');
    if (/<sitemapindex\b/i.test(xml)) sitemap = { urls: [], sitemapUrl: url, isIndex: true, subSitemaps: parseSitemapIndexBlock(xml) };
    else if (/<urlset\b/i.test(xml)) sitemap = { urls: parseUrlSetBlock(xml), sitemapUrl: url, isIndex: false, subSitemaps: [] };
  }
  return { robots, sitemap };
}

export async function runCheck(host: string, o: RunOptions): Promise<CheckOutcome> {
  const limits = o.limits ?? { ...DEFAULT_LIMITS, requestTimeoutMs: 10_000, requestBytes: 3 * 1024 * 1024 };
  const budget: Budget = { bytesLeft: RUN_BYTES, deadline: o.deadline };
  const timedOut = () => o.signal.aborted || Date.now() >= o.deadline;
  const startUrl = `https://${host}/`;

  const scopeResult = await buildScope(startUrl, o.transport, { requestTimeoutMs: limits.requestTimeoutMs });
  if (timedOut()) return { ok: false, error: 'timeout' };
  if (!scopeResult.ok) {
    return { ok: false, error: /non-public/.test(scopeResult.reason) ? 'refused' : 'unreachable' };
  }
  const scope = scopeResult.scope;
  const renderer = new SafeRenderer({ scope, transport: o.transport, limits, budget, signal: o.signal });
  const get: SafeGet = (url: string, document = true, accept = '*/*') => safeFetch(url, { method: 'GET', headers: { 'user-agent': USER_AGENT, accept } },
    { scope, transport: o.transport, limits, budget, document });

  // Start page, then the legal pages it links to.
  const first = await crawlSite(startUrl, 1, undefined, USER_AGENT, [], [], undefined, undefined, renderer, undefined, classifyWithoutNetwork);
  if (timedOut()) return { ok: false, error: 'timeout' };
  if (first.pages.length === 0) return { ok: false, error: 'unreachable' };
  const rawPages: PageData[] = [...first.pages];
  let stats = first.stats;
  const home = extractPageSEO(first.pages[0]);
  // the legal pages linked from the start page, matched by path like detectLegalPages does
  const legalPatterns = [IMPRINT_URL_PATTERNS, PRIVACY_URL_PATTERNS, COOKIE_URL_PATTERNS, TERMS_URL_PATTERNS];
  const legalUrls: string[] = [];
  for (const patterns of legalPatterns) {
    const hit = home.internalLinks.find(l => {
      try {
        return pathMatchesAny(new URL(l, rawPages[0].finalUrl).pathname, patterns);
      } catch {
        return false;
      }
    });
    if (hit) {
      const abs = new URL(hit, rawPages[0].finalUrl).href;
      if (!legalUrls.includes(abs)) legalUrls.push(abs);
    }
  }
  legalUrls.splice(MAX_PAGES - 1);
  for (const u of legalUrls) {
    if (timedOut()) return { ok: false, error: 'timeout' };
    const r = await crawlSite(u, 1, undefined, USER_AGENT, [], [], undefined, undefined, renderer, undefined, classifyWithoutNetwork);
    rawPages.push(...r.pages);
    stats = mergeStats(stats, r.stats);
  }
  if (timedOut()) return { ok: false, error: 'timeout' };
  const pages = rawPages.map(p => extractPageSEO(p));
  const origin = new URL(rawPages[0].finalUrl || startUrl).origin;

  // robots.txt and sitemap: through safe-fetch as well.
  const { robots, sitemap } = await robotsAndSitemap(origin, get);
  if (timedOut()) return { ok: false, error: 'timeout' };
  const hasSitemap = !!sitemap;
  if (timedOut()) return { ok: false, error: 'timeout' };

  let llms: LlmsTxtInfo;
  const lr = await safeFetch(`${origin}/llms.txt`, { method: 'GET', headers: { 'user-agent': USER_AGENT, accept: 'text/plain, text/markdown, */*' } },
    { scope, transport: o.transport, limits: { ...limits, requestBytes: LLMS_MAX_BYTES }, budget, document: true, truncate: true });
  llms = lr.ok
    ? classifyLlmsTxt(`${origin}/llms.txt`, lr.res.status, lr.res.headers['content-type'] ?? null, lr.res.body.toString('utf8'))
    : { status: 'error', url: `${origin}/llms.txt`, reason: lr.reason };
  if (timedOut()) return { ok: false, error: 'timeout' };

  // Loading speed: PageSpeed Insights sends the start URL to Google; only with a server key.
  let pageSpeed: PageSpeedData | undefined;
  if (o.pageSpeedKey) {
    pageSpeed = await checkPageSpeed(rawPages[0].finalUrl || startUrl, o.pageSpeedKey, 1, undefined, o.signal);
    if (pageSpeed.error) pageSpeed = undefined;
  }
  if (timedOut()) return { ok: false, error: 'timeout' };

  const homeRaw = rawPages[0];
  const homeHeaders = renderer.headersByUrl.get(homeRaw.finalUrl) ?? {};
  const securityHeaders = securityHeadersFrom(n => homeHeaders[n.toLowerCase()], homeRaw.finalUrl, homeRaw.html, homeRaw.finalUrl);
  const allHtml = rawPages.map(p => p.html).join('\n');

  const findings: Finding[] = [];
  findings.push(...generateSEOFindings(pages, robots.status === 'ok', hasSitemap));
  findings.push(...generateStructuredDataFindings(pages));
  findings.push(...generateOpenGraphFindings(pages));
  findings.push(...generateContentFindings(pages));
  findings.push(...generateImageDetailFindings(pages));
  findings.push(...generateTechFindings(pages, stats ?? emptyStats(), undefined, undefined));
  findings.push(...generateSecurityHeadersFindings(securityHeaders));
  findings.push(...generateRedirectFindings(pages, startUrl));
  findings.push(...generateThirdPartyScriptFindings(pages));
  findings.push(...generateInsecureLinkFindings(pages));
  findings.push(...generateLegalFindings(pages, allHtml));
  findings.push(...generateUXFindings(pages));
  findings.push(...generateFontLoadingFindings(pages));
  findings.push(...generateFaviconFindings(pages));
  findings.push(...generateTouchTargetFindings(pages));
  findings.push(...generatePerformanceFindings(pageSpeed, pages));
  const ai = evaluateAIVisibility({
    pages, rawPages, robots, llms, sitemap, modules: CHECK_MODULES,
    imprintFound: detectLegalPages(pages, allHtml.toLowerCase()).imprint.found,
  });
  findings.push(...ai.findings);

  const shown = CHECK_MODULES.filter(m => (m !== 'ai' || ai.info.score !== undefined) && (m !== 'performance' || !!pageSpeed));
  const moduleScores = shown.map(m => ({
    module: m,
    score: m === 'ai' ? (ai.info.score as number) : calculateModuleScore(findings, m),
    label_de: CHECK_LABELS[m].de,
    label_en: CHECK_LABELS[m].en,
  }));
  const inShown = findings.filter(f => shown.includes(f.module));
  return {
    ok: true,
    result: {
      host,
      score: weightedTotal(moduleScores),
      modules: moduleScores.map(m => ({ module: m.module, score: m.score })),
      findings: getTopFindings(inShown, 3).map(f => ({ de: plain(f, 'de'), en: plain(f, 'en') })),
      pages: rawPages.length,
      performanceMeasured: !!pageSpeed,
      checkedAt: new Date().toISOString(),
    },
  };
}
