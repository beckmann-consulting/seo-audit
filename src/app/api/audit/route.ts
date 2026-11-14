import { NextRequest, NextResponse } from 'next/server';
import { crawlSite } from '@/lib/crawler';
import { extractPageSEO } from '@/lib/extractor';
import {
  checkSSL, checkDNS, checkPageSpeed,
  checkSafeBrowsing, checkRobotsAndSitemap, checkSecurityHeaders,
  fetchSitemap, checkWwwConsistency, probeHeaders,
} from '@/lib/external-checks';
import { checkImageSizes } from '@/lib/external-image-sizes';
import { checkDeepImageFormats } from '@/lib/external-image-formats';
import { checkMobileDesktopParity } from '@/lib/external-mobile-desktop-parity';
import {
  generateSEOFindings, generateContentFindings, generateTechFindings,
  generateLegalFindings, generateUXFindings, generatePerformanceFindings,
  generateSafeBrowsingFindings, generateSecurityHeadersFindings,
  generateHreflangFindings, generateRobotsWildcardFindings,
  generateStructuredDataFindings, generateDuplicateContentFindings,
  generateCrawlStructureFindings, generateClientRenderingFindings,
  generateSitemapCoverageFindings, generateRedirectFindings, generateRedirectedInternalLinkFindings,
  generateCanonicalTargetFindings,
  generateAnchorTextFindings, generateRobotsConflictFindings,
  generateOpenGraphFindings, generateSitemapQualityFindings,
  generateRichResultsFindings, generateImageDetailFindings,
  generateBodyDuplicateFindings, generateTextHtmlRatioFindings,
  generateReadabilityFindings, generateOversizedImageFindings,
  generateLegacyImageFormatFindings, generateDeepImageFormatFindings,
  generateAccessibilityFindings, generateGscFindings, generateBingFindings,
  generateFontLoadingFindings, generateThirdPartyScriptFindings,
  generateFaviconFindings, generateURLQualityFindings,
  generateTouchTargetFindings,
  generateWwwConsistencyFindings, generateXRobotsFindings,
  generatePixelWidthFindings, generateInsecureLinkFindings,
  generateMixedStructuredDataFindings, generateMobileDesktopParityFindings,
  generateJsRenderingFindings,
  calculateModuleScore, getTopFindings
} from '@/lib/findings-engine';
import { generateClaudePrompt } from '@/lib/claude-prompt';
import { evaluateAIVisibility, fetchLlmsTxt, weightedTotal, needsSitemap, type LocalRenderOutcome } from '@/lib/ai-visibility';
import { LOCAL_RENDER_SAMPLE } from '@/lib/ai-visibility/local-render';
import { detectLegalPages } from '@/lib/util/legal-page-detection';
import type { AIVisibilityInfo, LlmsTxtInfo } from '@/lib/ai-visibility/types';
import { resolveUserAgent, getRobotsToken } from '@/lib/util/user-agents';
import { compileFilterPatterns, FilterPatternError } from '@/lib/util/url-filter';
import { buildBasicAuthHeader, sanitizeConfigForClient } from '@/lib/util/auth';
import { StaticRenderer } from '@/lib/renderer';
import type { Renderer } from '@/lib/renderer';
import { captureScreenshotsForAudit, type ScreenshotCapableRenderer } from '@/lib/screenshots';
import { resolveGscResult, emitGscWarning } from '@/lib/external-gsc/route-helper';
import { resolveBingResult, emitBingWarning } from '@/lib/external-bing/route-helper';
import { getBingApiKey } from '@/lib/external-bing/auth';
import type { GscResult, BingResult, StreamEvent, SSLInfo } from '@/types';
import type { AuditConfig, AuditResult, ModuleScore, Module, Finding } from '@/types';
import { CheckLog, outcome, type CheckOutcome } from '@/lib/checks/check-log';
import { newChecksDeadline, stepBudget, readNewCheckBudgets, budgetNote } from '@/lib/util/platform-limit';
import { checkSoft404 } from '@/lib/checks/soft-404';
import { checkHttpToHttps } from '@/lib/checks/http-https';
import { generateLanguageFindings } from '@/lib/findings/language';
import { generateMetaNoindexFindings, generateMapLinkFindings } from '@/lib/findings/local-and-index';
import { generateAltQualityFindings } from '@/lib/findings/alt-quality';
import { generateInboundAnchorFindings } from '@/lib/findings/inbound-anchors';
import { generateNapFindings } from '@/lib/findings/nap';
import { generateTargetKeywordFindings, validateTargetKeywords } from '@/lib/checks/target-keywords';
import { recordOpeningHours, recordLastModified } from '@/lib/checks/part-e';
import { recordScriptLoading, recordModernFormats } from '@/lib/checks/part-a';
import { checkHreflangTargets, DEFAULT_MAX_REQUESTS } from '@/lib/checks/hreflang-targets';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { measureLighthouse, pickLighthousePages, lighthouseFindings, RUN_MS, DEFAULT_PAGES, MIN_RUNS } from '@/lib/lighthouse/local';
import { isSensitiveHeader } from '@/lib/util/auth';
import type { LighthouseLocalInfo } from '@/types';

export const maxDuration = 900; // = PLATFORM_MAX_DURATION_S (lib/util/platform-limit.ts); `next start` ignores it, see there

// A9.2 — When sitemap.xml is found, feed up to this many URLs into the
// crawler queue as additional seeds. Tighter than the parser's 5000-cap
// because here we'll actually fetch every URL — limit keeps audit time
// bounded for sites with multi-thousand-entry sitemaps.
const MAX_SITEMAP_SEEDS = 200;

const MODULE_LABELS: Record<Module, { de: string; en: string }> = {
  seo: { de: 'SEO', en: 'SEO' },
  content: { de: 'Inhalte', en: 'Content' },
  legal: { de: 'Rechtliches', en: 'Legal' },
  ux: { de: 'UX & Struktur', en: 'UX & Structure' },
  tech: { de: 'Technik', en: 'Tech' },
  performance: { de: 'Performance', en: 'Performance' },
  accessibility: { de: 'Barrierefreiheit', en: 'Accessibility' },
  offers: { de: 'Angebote', en: 'Offers' },
  ai: { de: 'KI-Sichtbarkeit', en: 'AI visibility' },
};

// StreamEvent is centralised in @/types so client and server can't
// drift. See the import at the top.

function encodeSSE(event: StreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ============================================================
//  Audit runner — emits progress via `send`, returns the result.
// ============================================================
async function runAudit(
  config: AuditConfig,
  send: (event: StreamEvent) => void,
  includeRegexes: RegExp[],
  excludeRegexes: RegExp[],
  renderer: Renderer,
): Promise<AuditResult | null> {
  const progress = (step: string, percent: number, detail?: string) =>
    send({ type: 'progress', step, percent, detail });

  // Normalize URL
  let url = config.url.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  const domain = new URL(url).hostname;

  // Resolve UA once — every HTTP fetch in the audit pipeline uses
  // this string. Audits run "as Googlebot" or "as a custom crawler"
  // need consistent identification across crawler, security headers,
  // sitemap fetches, llms.txt, etc.
  const userAgent = resolveUserAgent(config);
  const robotsBotToken = getRobotsToken(config);
  // Pre-build the Basic Auth header so each fetcher just attaches the
  // string — credentials never appear unmasked in any code path past
  // this line.
  const authHeader = buildBasicAuthHeader(config.basicAuth);
  const customHeaders = config.customHeaders;

  // ultimate-41: the check log (one entry per point of the order), and the end of the new checks: 30 s before the
  // platform limit (lib/util/platform-limit.ts); budgets from the environment, cut to that limit
  const checkLog = new CheckLog(config.modules);
  const checksDeadline = newChecksDeadline(Date.now());
  const budgets = readNewCheckBudgets();

  // ---- STEP 1: DNS (5%) ----
  progress('dns_check', 5);
  const dnsInfo = config.modules.includes('tech') ? await checkDNS(domain) : undefined;

  // ---- STEP 2: SSL (10%) — kicked off in parallel ----
  // SSL Labs polling can take up to 180s. We start it here but don't
  // await yet — the crawl, sitemap, PSI and security-headers steps run
  // concurrently, and we await the result just before findings
  // generation. Worst-case the audit waits at most 180s in addition
  // to whatever was happening anyway, which is much faster than
  // serializing a 180s wait before the rest of the pipeline.
  progress('ssl_check', 10);
  const sslInfoPromise: Promise<SSLInfo | undefined> = config.modules.includes('tech')
    ? checkSSL(domain)
    : Promise.resolve(undefined);

  // ---- STEP 3: robots.txt (15%) ----
  progress('robots_fetch', 15);
  const { hasRobots, hasSitemap, robotsContent, sitemapUrl, robotsFetch } = await checkRobotsAndSitemap(url, userAgent, authHeader, customHeaders);

  // ---- STEP 4: sitemap.xml (20%) ----
  progress('sitemap_fetch', 20);
  // ultimate-40: the AI visibility module compares lastmod too, so it loads
  // the sitemap as well when seo is not selected.
  const sitemapInfo = (hasSitemap && sitemapUrl && needsSitemap(config.modules))
    ? await fetchSitemap(sitemapUrl, userAgent, authHeader, customHeaders)
    : undefined;

  // A9.2 — feed sitemap-discovered URLs into the crawler queue so
  // footer-only or multi-language pages aren't missed. Capped at
  // MAX_SITEMAP_SEEDS because the parser allows much larger sitemaps
  // than we want to actually fetch.
  const sitemapSeeds = sitemapInfo?.urls
    ? sitemapInfo.urls.slice(0, MAX_SITEMAP_SEEDS).map(u => u.url).filter(Boolean)
    : undefined;

  // ---- STEP 5: Crawl (25% → 70%) ----
  progress('crawl_start', 25);
  let lastCrawlPercent = 25;
  const { pages: rawPages, stats: crawlStats } = await crawlSite(
    url,
    config.maxPages || 0,
    (crawled, total, currentUrl) => {
      const ratio = total > 0 ? crawled / total : 0;
      const raw = Math.round(25 + ratio * 45);
      // Monotonic clamp — progress must only go forward
      const clamped = Math.max(lastCrawlPercent, Math.min(70, raw));
      lastCrawlPercent = clamped;
      progress('crawl_progress', clamped, currentUrl);
    },
    userAgent,
    includeRegexes,
    excludeRegexes,
    authHeader,
    customHeaders,
    renderer,
    sitemapSeeds,
  );

  if (rawPages.length === 0) {
    send({ type: 'error', message: `Could not fetch ${url}. Check the URL.` });
    return null;
  }

  // Extract SEO data and annotate homepage
  const pages = rawPages.map(p => extractPageSEO(p));
  pages[0].hasRobots = hasRobots;
  pages[0].hasSitemap = hasSitemap;

  // ---- STEP 6: PageSpeed + Safe Browsing (75%) ----
  // Use client-provided key first, fall back to server env so the Env-
  // configured key actually drives the audit when the UI field is empty.
  // Run PSI twice by default (quickMode=false) and average the numeric
  // metrics to smooth out the ~±5-point Lighthouse score variance.
  const googleKey = config.googleApiKey || process.env.GOOGLE_API_KEY || '';
  const psiRuns = config.quickMode ? 1 : 2;
  progress('pagespeed_check', 75);
  const pageSpeedData = (googleKey && config.modules.includes('performance'))
    ? await checkPageSpeed(url, googleKey, psiRuns, (runNumber, totalRuns) => {
        // Run 1 emits at 75%, subsequent runs at +3% each — keeps the
        // bar moving while staying below the 80% security_headers step.
        const pct = Math.min(79, 75 + (runNumber - 1) * 3);
        progress('pagespeed_check', pct, totalRuns > 1 ? `Run ${runNumber}/${totalRuns}` : undefined);
      })
    : undefined;
  const safeBrowsingData = googleKey
    ? await checkSafeBrowsing(url, googleKey)
    : undefined;

  // ultimate-41 (point 4): Lighthouse on this server when there is no Google key (lib/lighthouse/local.ts). Its lab
  // values stay in lighthouseLocal; only the start page's mobile median-run score sets the performance score below.
  let lighthouseLocal: LighthouseLocalInfo | undefined;
  const lighthouseFound: Finding[] = [];
  let lighthouseHomeMobile: number | undefined;
  if (checkLog.isSelected('lighthouse-local')) {
    const chromePath = process.env.LIGHTHOUSE_CHROMIUM || process.env.AI_LOCAL_CHROMIUM || '';
    const sensitive = Boolean(authHeader) || Object.keys(customHeaders ?? {}).some(isSensitiveHeader);
    const otherHeaders = Object.keys(customHeaders ?? {}).filter(h => !isSensitiveHeader(h));
    const budgetMs = stepBudget(budgets.lighthouse.ms, checksDeadline);
    const note = budgetNote('LIGHTHOUSE_BUDGET_MS', budgets.lighthouse);
    if (googleKey) {
      checkLog.record('lighthouse-local', { status: 'not-applicable', summary_de: 'Google-Schlüssel vorhanden: PageSpeed Insights misst statt Lighthouse lokal.', summary_en: 'Google key present: PageSpeed Insights measures instead of local Lighthouse.' });
    } else if (config.lighthouse === 'off') {
      checkLog.record('lighthouse-local', { status: 'not-configured', summary_de: 'Lighthouse lokal ist ausgeschaltet.', summary_en: 'Local Lighthouse is switched off.' });
    } else if (sensitive) {
      checkLog.record('lighthouse-local', { status: 'not-checkable', summary_de: 'Lighthouse lokal läuft nicht mit Zugangsdaten (Basic Auth oder sensible eigene Header): Lighthouse sendet Kopfzeilen an alle Ursprünge.', summary_en: 'Local Lighthouse does not run with credentials (basic auth or sensitive custom headers): Lighthouse sends headers to every origin.' });
    } else if (!chromePath) {
      checkLog.record('lighthouse-local', { status: 'not-checkable', summary_de: 'Kein Chromium eingerichtet (LIGHTHOUSE_CHROMIUM oder AI_LOCAL_CHROMIUM).', summary_en: 'No Chromium set up (LIGHTHOUSE_CHROMIUM or AI_LOCAL_CHROMIUM).' });
    } else if (budgetMs < RUN_MS) {
      checkLog.record('lighthouse-local', withNote({ status: 'not-checkable', summary_de: 'Zeit bis zur Plattformgrenze reicht für keinen Lauf.', summary_en: 'Not enough time before the platform limit for a single run.' }, note));
    } else {
      const pagesWanted = config.quickMode ? 1 : positiveInt(process.env.LIGHTHOUSE_PAGES, DEFAULT_PAGES);
      const runs = Math.max(MIN_RUNS, positiveInt(process.env.LIGHTHOUSE_RUNS, MIN_RUNS));
      const auditPort = Number(new URL(url).port) || undefined;
      const { createChromeRunner } = await import('@/lib/lighthouse/runner');
      progress('lighthouse_local', 76);
      try {
        const runner = await createChromeRunner({ chromePath, extraPorts: auditPort ? [auditPort] : undefined });
        lighthouseLocal = await measureLighthouse({
          urls: pickLighthousePages(pages, pagesWanted), runs, deadline: Date.now() + budgetMs, runner,
          onProgress: detail => progress('lighthouse_local', 77, detail),
        });
        if (otherHeaders.length > 0) lighthouseLocal.notes.push(`custom headers not sent: ${otherHeaders.join(', ')}`);
        const lf = lighthouseFindings(lighthouseLocal);
        lighthouseFound.push(...lf.findings);
        lighthouseHomeMobile = lf.homeMobileScore;
        checkLog.record('lighthouse-local', withNote(lf.outcome, note));
      } catch (e) {
        checkLog.record('lighthouse-local', { status: 'not-checkable', summary_de: `Lighthouse lokal scheiterte: ${String((e as Error)?.message ?? e)}`, summary_en: `Local Lighthouse failed: ${String((e as Error)?.message ?? e)}` });
      }
    }
  }

  // ---- STEP 7: Security Headers (80%) ----
  progress('security_headers', 80);
  const securityHeaders = config.modules.includes('tech')
    ? await checkSecurityHeaders(url, rawPages[0]?.html, userAgent, authHeader, customHeaders)
    : undefined;

  // ---- STEP 7b: www / non-www consistency ----
  const wwwConsistency = config.modules.includes('tech')
    ? await checkWwwConsistency(url, userAgent, authHeader, customHeaders)
    : undefined;

  // ---- STEP 8: AI visibility (85%) ----
  // ultimate-40: replaces the AI crawler readiness of the seo module. Here
  // only llms.txt of the audited origin is fetched; the seven checks run
  // with the findings below, on what the audit already has.
  progress('ai_crawler_check', 85);
  const llmsInfo: LlmsTxtInfo | undefined = config.modules.includes('ai')
    ? await fetchLlmsTxt(url, { auditHeaders: probeHeaders(userAgent, authHeader, customHeaders) as Record<string, string> | undefined })
    : undefined;
  // Check 5 without Browserless: an optional local Chromium (AI_LOCAL_CHROMIUM,
  // nothing downloaded) renders a sample of the pages Browserless did not
  // render, with no network of its own (lib/ai-visibility/local-render.ts).
  let localRender: Map<string, LocalRenderOutcome> | undefined;
  const localChromium = process.env.AI_LOCAL_CHROMIUM;
  if (config.modules.includes('ai') && localChromium) {
    const sample = rawPages.filter(p => p.renderMode !== 'js').slice(0, LOCAL_RENDER_SAMPLE).map(p => p.url);
    if (sample.length > 0) {
      const { localRender: render } = await import('@/lib/ai-visibility/local-render');
      const h = probeHeaders(userAgent, authHeader, customHeaders) as Record<string, string> | undefined;
      localRender = await render({ executablePath: localChromium, auditUrl: url, urls: sample, auditHeaders: h });
    }
  }

  // ---- STEP 8b: Image-size HEAD probes ----
  // Default 20 unique images probed; user can disable by setting 0.
  const imageProbeLimit = config.imageHeadCheckLimit ?? 20;
  const imageSizes = (imageProbeLimit > 0 && config.modules.includes('content'))
    ? await checkImageSizes(pages, imageProbeLimit, userAgent, authHeader, customHeaders)
    : undefined;

  // Opt-in deep image-format probe — fires up to 30*2 HEAD requests.
  const deepImageFormatResults = (config.deepImageFormatCheck && config.modules.includes('content'))
    ? await checkDeepImageFormats(pages, userAgent, authHeader, customHeaders)
    : undefined;

  // ---- STEP 8c: Mobile/Desktop parity (opt-in, doubles fetch cost) ----
  const paritySampleSize = config.mobileDesktopParitySampleSize ?? 10;
  const mobileDesktopParity = config.mobileDesktopParityCheck
    ? await checkMobileDesktopParity(pages, paritySampleSize, authHeader, customHeaders)
    : undefined;

  // ---- STEP 8d: Screenshots (opt-in, JS-mode only) ----
  // Captured by the same Browserless session that drove the crawl;
  // static-mode audits skip silently because there's no Chromium to
  // drive. Failures are tolerated — we don't want a flaky screenshot
  // pass to invalidate an otherwise-completed audit.
  // Both 'js' and 'auto' provide a screenshot-capable renderer:
  // JsRenderer directly, AutoRenderer via its captureScreenshot
  // delegation to the inner JS renderer.
  const jsCapable = config.rendering === 'js' || config.rendering === 'auto';
  const screenshots = (config.includeScreenshots && jsCapable)
    ? await captureScreenshotsForAudit(renderer as unknown as ScreenshotCapableRenderer, pages)
    : undefined;

  // ---- STEP 8e: Google Search Console ----
  // Always populates a gscResult — even a "disabled" entry — so the
  // UI can render the right banner without ambiguity. Three failure
  // states (no token, property-not-found, api-error) all produce
  // a successful audit; only the headline tab gets a different hint.
  progress('gsc_fetch', 88);
  const gscResult: GscResult = await resolveGscResult({
    domain,
    refreshToken: process.env.GSC_REFRESH_TOKEN,
  });
  // Live warning during the SSE stream when GSC's API hiccupped
  // (state='api-error'). The other three states are intentional
  // outcomes that the final result banner already covers.
  emitGscWarning(gscResult, send);

  // ---- STEP 8f: Bing Webmaster Tools ----
  // Same shape as GSC: always populates a bingResult so the UI can
  // render the right banner without distinguishing "Bing was never
  // tried" from "Bing tried and produced no data". 4-state graceful
  // degradation, all four producing a successful (200) audit.
  progress('bing_check', 89);
  const bingResult: BingResult = await resolveBingResult({
    siteUrl: url,
    apiKey: getBingApiKey() ?? undefined,
  });
  emitBingWarning(bingResult, send);

  // ---- STEP 9: Findings generation (90%) ----
  // Resolve the SSL Labs scan that was kicked off in step 2. By now
  // the polling has had the entire crawl + PSI window to finish; a
  // freshly-issued cert on a slow site may still hit the 180s budget,
  // in which case sslInfo.pendingSlow is set and downstream code
  // treats it as a neutral "scan still running" outcome.
  const sslInfo = await sslInfoPromise;
  // ultimate-41 (points 2 and 3): a made-up URL, and http → https, through checked and pinned fetches; both share
  // one budget (PROBE_BUDGET_MS). The audit's own headers go to its exact origin only (lib/checks/probe.ts).
  const probeFindings: Finding[] = [];
  if (checkLog.isSelected('soft-404') || checkLog.isSelected('http-to-https')) {
    progress('probe_checks', 89);
    const budgetMs = stepBudget(budgets.probes.ms, checksDeadline);
    const note = budgetNote('PROBE_BUDGET_MS', budgets.probes);
    if (budgetMs < 10_000) {
      const tooLate: CheckOutcome = { status: 'not-checkable', summary_de: 'Zeit bis zur Plattformgrenze reicht nicht.', summary_en: 'Not enough time left before the platform limit.' };
      checkLog.record('soft-404', withNote(tooLate, note));
      checkLog.record('http-to-https', withNote(tooLate, note));
    } else {
      const probeOpts = {
        auditUrl: url, userAgent, deadline: Date.now() + budgetMs, scopes: new Map(),
        auditHeaders: probeHeaders(undefined, authHeader, customHeaders) as Record<string, string> | undefined,
      };
      const soft = await checkSoft404({ ...probeOpts, startUrl: pages[0]?.url ?? url });
      checkLog.record('soft-404', withNote(soft.outcome, note));
      probeFindings.push(...soft.findings);
      const http = await checkHttpToHttps({ ...probeOpts, pages });
      checkLog.record('http-to-https', withNote(http.outcome, note));
      probeFindings.push(...http.findings);
    }
  }

  // ultimate-41 (point 6): status and canonical of every hreflang target; crawled ones from the crawl, the others
  // fetched without the audit's credentials, within HREFLANG_PROBE_BUDGET_MS and HREFLANG_PROBE_MAX_REQUESTS
  const hreflangFound: Finding[] = [];
  if (checkLog.isSelected('hreflang-targets')) {
    progress('hreflang_targets', 89);
    const budgetMs = stepBudget(budgets.hreflangProbes.ms, checksDeadline);
    const r = await checkHreflangTargets({
      pages, httpErrors: crawlStats.httpErrors, userAgent, deadline: Date.now() + budgetMs,
      maxRequests: positiveInt(process.env.HREFLANG_PROBE_MAX_REQUESTS, DEFAULT_MAX_REQUESTS),
    });
    checkLog.record('hreflang-targets', withNote(r.outcome, budgetNote('HREFLANG_PROBE_BUDGET_MS', budgets.hreflangProbes)));
    hreflangFound.push(...r.findings);
  }

  progress('findings_generation', 90);
  const allHtml = rawPages.map(p => p.html).join('\n');
  const allFindings: Finding[] = [];

  if (config.modules.includes('seo')) {
    allFindings.push(...generateSEOFindings(pages, hasRobots, hasSitemap));
    allFindings.push(...generateCanonicalTargetFindings(pages, crawlStats.httpErrors));
    allFindings.push(...generateHreflangFindings(pages));
    allFindings.push(...hreflangFound);
    allFindings.push(...generateRobotsWildcardFindings(robotsContent));
    allFindings.push(...generateStructuredDataFindings(pages));
    allFindings.push(...generateDuplicateContentFindings(pages, checkLog));
    // ultimate-41 (points 5 and 19): languages per page; og:locale:alternate read from the crawled HTML only here
    allFindings.push(...generateLanguageFindings(pages, new Map(rawPages.map(rp => [normaliseUrl(rp.url), rp.html])), checkLog, allFindings));
    allFindings.push(...generateCrawlStructureFindings(pages));
    allFindings.push(...generateSitemapCoverageFindings(pages, sitemapInfo));
    allFindings.push(...generateAnchorTextFindings(pages));
    allFindings.push(...generateRobotsConflictFindings(pages, robotsContent, sitemapInfo, robotsBotToken));
    allFindings.push(...generateOpenGraphFindings(pages));
    allFindings.push(...generateSitemapQualityFindings(sitemapInfo, url));
    allFindings.push(...generateRichResultsFindings(pages, pageSpeedData));
    allFindings.push(...generateURLQualityFindings(pages));
    allFindings.push(...generateXRobotsFindings(pages));
    // ultimate-41 (points 18 and 11)
    allFindings.push(...generateMetaNoindexFindings(pages, sitemapInfo, checkLog, allFindings));
    allFindings.push(...generateMapLinkFindings(pages, checkLog));
    // ultimate-41 (point 14): the link graph with anchor texts, from the crawled HTML, during the analysis only
    allFindings.push(...generateInboundAnchorFindings(pages, rawPages, checkLog));
    // ultimate-41 (point 10): name, address, phone from JSON-LD, imprint and footer
    allFindings.push(...generateNapFindings(pages, rawPages, checkLog));
    // ultimate-41 (point 13)
    allFindings.push(...generateTargetKeywordFindings(pages, config.targetKeywords, checkLog));
    allFindings.push(...generatePixelWidthFindings(pages));
    allFindings.push(...generateMixedStructuredDataFindings(pages));
    allFindings.push(...generateMobileDesktopParityFindings(mobileDesktopParity));
    allFindings.push(...generateGscFindings(pages, gscResult, sitemapInfo));
    allFindings.push(...generateBingFindings(pages, bingResult));
  }
  if (config.modules.includes('content')) {
    allFindings.push(...generateContentFindings(pages));
    allFindings.push(...generateImageDetailFindings(pages));
    // ultimate-41 (point 20): alt texts by content, read from the crawled HTML during the analysis only
    allFindings.push(...generateAltQualityFindings(pages, rawPages, checkLog));
    allFindings.push(...generateBodyDuplicateFindings(pages));
    allFindings.push(...generateTextHtmlRatioFindings(pages));
    allFindings.push(...generateReadabilityFindings(pages));
    allFindings.push(...generateOversizedImageFindings(imageSizes));
    allFindings.push(...generateLegacyImageFormatFindings(pages, imageSizes));
    allFindings.push(...generateDeepImageFormatFindings(deepImageFormatResults, imageSizes));
  }
  if (config.modules.includes('tech')) {
    allFindings.push(...generateTechFindings(pages, crawlStats, sslInfo, dnsInfo));
    allFindings.push(...generateSecurityHeadersFindings(securityHeaders));
    allFindings.push(...generateClientRenderingFindings(pages));
    allFindings.push(...generateRedirectFindings(pages, url));
    allFindings.push(...generateRedirectedInternalLinkFindings(pages));
    allFindings.push(...generateThirdPartyScriptFindings(pages));
    allFindings.push(...generateWwwConsistencyFindings(wwwConsistency));
    allFindings.push(...generateInsecureLinkFindings(pages));
    allFindings.push(...generateJsRenderingFindings(pages));
    allFindings.push(...probeFindings);
  }
  if (config.modules.includes('legal')) {
    allFindings.push(...generateLegalFindings(pages, allHtml, checkLog));
  }
  if (config.modules.includes('ux')) {
    allFindings.push(...generateUXFindings(pages));
    allFindings.push(...generateFontLoadingFindings(pages));
    allFindings.push(...generateFaviconFindings(pages));
    allFindings.push(...generateTouchTargetFindings(pages));
  }
  if (config.modules.includes('performance')) {
    allFindings.push(...generatePerformanceFindings(pageSpeedData, pages));
    allFindings.push(...lighthouseFound);
  }
  if (safeBrowsingData) {
    allFindings.push(...generateSafeBrowsingFindings(safeBrowsingData));
  }
  let aiVisibility: AIVisibilityInfo | undefined;
  if (config.modules.includes('ai') && llmsInfo) {
    const ev = evaluateAIVisibility({
      pages, rawPages, robots: robotsFetch, llms: llmsInfo, sitemap: sitemapInfo, modules: config.modules,
      imprintFound: detectLegalPages(pages, allHtml.toLowerCase()).imprint.found,
      localRender,
    });
    aiVisibility = ev.info;
    allFindings.push(...ev.findings);
  }
  // Accessibility runs as its own module — generates findings whenever
  // the user picked the module, even in static mode (where it just
  // emits the "JS-mode required" guidance finding).
  allFindings.push(...generateAccessibilityFindings(pages, config.modules.includes('accessibility')));

  // ultimate-41, part E (websites-33 did the work, journal plan section 6): the log shows both rules per run
  recordOpeningHours(checkLog, pages, allFindings);
  recordLastModified(checkLog, pages.map((p, i) => ({ url: p.url, seo: p, lastModified: rawPages[i]?.lastModified })), sitemapInfo, allFindings);

  // ultimate-41 (points 1 and 16): corrected rules of before; their log entries follow from what was measured
  recordScriptLoading(checkLog, pages, config.modules, allFindings);
  recordModernFormats(checkLog, pages, allFindings);

  // ---- Scores ----
  // ai has a score of its own (coverage, shadow entries); without an
  // assessable check it has none and stays out of the scores and the total.
  const moduleScores: ModuleScore[] = config.modules
    .filter(m => m !== 'ai' || aiVisibility?.score !== undefined)
    .map(m => ({
      module: m,
      score: m === 'ai' ? (aiVisibility?.score as number) : calculateModuleScore(allFindings, m),
      label_de: MODULE_LABELS[m].de,
      label_en: MODULE_LABELS[m].en,
    }));

  if (pageSpeedData?.seoScore) {
    const seoModule = moduleScores.find(m => m.module === 'seo');
    if (seoModule) {
      seoModule.score = Math.round((seoModule.score + pageSpeedData.seoScore) / 2);
    }
  }

  // Performance module score fallback when CrUX field data is sparse.
  // Without enough field metrics we can't emit per-metric findings, so
  // the findings-based score would be inflated (no findings = high
  // score) and misleading. Use the Lighthouse Performance score
  // directly as the module score in that case — lab perf score is a
  // meaningful measurement on its own, even if the per-metric values
  // shouldn't be shown to users. Mixed availability (≥2 CrUX metrics
  // available) keeps the standard findings-based score.
  const perfModule = moduleScores.find(m => m.module === 'performance');
  if (perfModule && pageSpeedData?.performanceScore !== undefined) {
    const cruxAvailableCount = (
      [pageSpeedData.lcpSource, pageSpeedData.inpSource, pageSpeedData.clsSource,
       pageSpeedData.fcpSource, pageSpeedData.ttfbSource]
        .filter(s => s === 'field').length
    );
    if (cruxAvailableCount < 2) {
      perfModule.score = pageSpeedData.performanceScore;
    }
  } else if (perfModule && lighthouseHomeMobile !== undefined) {
    // ultimate-41 (point 4): without PSI there are no field values; the module is the lab score, as with PSI above
    perfModule.score = lighthouseHomeMobile;
  }

  // Weighted mean (ultimate-40): every module 1, ai 0.5. Without ai it is
  // the plain mean of before.
  const totalScore = weightedTotal(moduleScores);

  // ---- Strengths ----
  const strengths_de: string[] = [];
  const strengths_en: string[] = [];

  if (url.startsWith('https://')) {
    strengths_de.push('HTTPS aktiv — sichere Verbindung für alle Besucher.');
    strengths_en.push('HTTPS active — secure connection for all visitors.');
  }
  if (hasRobots) {
    strengths_de.push('robots.txt vorhanden — Suchmaschinen-Crawling korrekt konfiguriert.');
    strengths_en.push('robots.txt present — search engine crawling correctly configured.');
  }
  if (hasSitemap) {
    strengths_de.push('XML-Sitemap vorhanden — hilft Google alle Seiten zu finden.');
    strengths_en.push('XML sitemap present — helps Google find all pages.');
  }
  if (pages.some(p => p.schemaTypes.length > 0)) {
    const types = [...new Set(pages.flatMap(p => p.schemaTypes))].slice(0, 3).join(', ');
    strengths_de.push(`Schema.org Markup vorhanden (${types}) — ermöglicht Rich Snippets.`);
    strengths_en.push(`Schema.org markup present (${types}) — enables rich snippets.`);
  }
  if (sslInfo?.grade && ['A+', 'A', 'A-'].includes(sslInfo.grade)) {
    strengths_de.push(`Hervorragende SSL-Konfiguration (Grade ${sslInfo.grade}).`);
    strengths_en.push(`Excellent SSL configuration (Grade ${sslInfo.grade}).`);
  }
  if (pageSpeedData?.performanceScore && pageSpeedData.performanceScore >= 75) {
    strengths_de.push(`Guter PageSpeed Score: ${pageSpeedData.performanceScore}/100.`);
    strengths_en.push(`Good PageSpeed score: ${pageSpeedData.performanceScore}/100.`);
  }
  if (aiVisibility && ['crawlers', 'snippets'].every(c => aiVisibility?.checks.find(x => x.id === c)?.status === 'pass')) {
    strengths_de.push('KI-Crawler für Antworten zugelassen, keine Snippet-Sperre.');
    strengths_en.push('AI crawlers for answers allowed, no snippet block.');
  }
  if (crawlStats.brokenLinks.length === 0) {
    strengths_de.push('Keine defekten Links gefunden — saubere Link-Struktur.');
    strengths_en.push('No broken links found — clean link structure.');
  }
  if (strengths_de.length < 3) {
    strengths_de.push(`${crawlStats.crawledPages} Seiten erfolgreich gecrawlt.`);
    strengths_en.push(`${crawlStats.crawledPages} pages successfully crawled.`);
  }

  // ---- Summary ----
  // Lighthouse-aligned score buckets (≥90 good, 50-89 needs improvement,
  // <50 poor) — same thresholds as METRIC_THRESHOLDS.score so the
  // headline label and the per-metric ratings stay coherent.
  const criticalCount = allFindings.filter(f => f.priority === 'critical').length;
  const importantCount = allFindings.filter(f => f.priority === 'important').length;
  const recommendedCount = allFindings.filter(f => f.priority === 'recommended').length;
  const optionalCount = allFindings.filter(f => f.priority === 'optional').length;
  const scoreLabel_de = totalScore >= 90 ? 'gut' : totalScore >= 50 ? 'verbesserungswürdig' : 'schlecht';
  const scoreLabel_en = totalScore >= 90 ? 'good' : totalScore >= 50 ? 'needs improvement' : 'poor';

  // Two weakest modules — lowest score wins, tie-broken by finding count
  // (more findings → higher leverage opportunity). Restricted to scores
  // < 90 so a uniformly excellent audit doesn't produce a misleading
  // "biggest leverage" sentence.
  const weakestModules = [...moduleScores]
    .filter(m => m.score < 90)
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const af = allFindings.filter(f => f.module === a.module).length;
      const bf = allFindings.filter(f => f.module === b.module).length;
      return bf - af;
    })
    .slice(0, 2);

  const leverageDe = weakestModules.length === 0
    ? 'Alle Module liegen über 90 Punkten — die folgenden Empfehlungen sind primär feinjustierungen.'
    : weakestModules.length === 1
      ? `Der größte Hebel liegt in **${weakestModules[0].label_de}**, dem Modul mit dem niedrigsten Score.`
      : `Die größten Hebel liegen in **${weakestModules[0].label_de}** und **${weakestModules[1].label_de}**, wo die niedrigsten Modul-Scores festgestellt wurden.`;
  const leverageEn = weakestModules.length === 0
    ? 'All modules are above 90 — the recommendations that follow are primarily fine-tuning.'
    : weakestModules.length === 1
      ? `The greatest leverage lies in **${weakestModules[0].label_en}**, the module with the lowest score.`
      : `The greatest leverage lies in **${weakestModules[0].label_en}** and **${weakestModules[1].label_en}**, where the lowest module scores were measured.`;

  // Bold tokens are wrapped in **...** — both PDF and HTML render
  // these inline. See pdf-generator.renderRichText / AuditApp summary
  // panel for parsers.
  const summary_de = `**${domain}** erreicht einen Gesamtscore von **${totalScore}/100** (${scoreLabel_de}). Bei ${crawlStats.crawledPages} gecrawlten Seiten wurden ${allFindings.length} Verbesserungsmöglichkeiten identifiziert: ${criticalCount} kritisch, ${importantCount} wichtig, ${recommendedCount} empfohlen und ${optionalCount} optional. ${leverageDe} Die priorisierten Empfehlungen folgen auf den nächsten Seiten.`;
  const summary_en = `**${domain}** achieves an overall score of **${totalScore}/100** (${scoreLabel_en}). Across ${crawlStats.crawledPages} crawled pages, ${allFindings.length} improvement opportunities were identified: ${criticalCount} critical, ${importantCount} important, ${recommendedCount} recommended, and ${optionalCount} optional. ${leverageEn} The prioritized recommendations follow on the next pages.`;

  const auditResult: AuditResult = {
    // sanitizeConfigForClient strips basicAuth and masks googleApiKey
    // so credentials never round-trip to the browser / cache / PDF.
    config: sanitizeConfigForClient({ ...config, url }),
    auditedAt: new Date().toISOString(),
    domain,
    totalScore,
    moduleScores,
    findings: allFindings,
    strengths_de,
    strengths_en,
    crawlStats,
    sslInfo,
    dnsInfo,
    pageSpeedData,
    safeBrowsingData,
    securityHeaders,
    aiVisibility,
    sitemapInfo,
    wwwConsistency,
    pages,
    imageSizes,
    mobileDesktopParity,
    screenshots,
    gscResult,
    bingResult,
    topFindings: getTopFindings(allFindings, 5),
    checkLog: checkLog.entries(),
    lighthouseLocal,
    claudePrompt: '',
    summary_de,
    summary_en,
  };

  auditResult.claudePrompt = generateClaudePrompt(auditResult);

  progress('complete', 100);
  return auditResult;
}

// ============================================================
//  POST handler — always responds with an SSE stream
// ============================================================
export async function POST(req: NextRequest) {
  let config: AuditConfig;
  try {
    config = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!config.url) {
    return NextResponse.json({ error: 'URL required' }, { status: 400 });
  }

  // ultimate-41 (point 13): target keywords checked before the stream opens, like the filter patterns below
  const kw = validateTargetKeywords(config.targetKeywords);
  if (!kw.ok) return NextResponse.json({ error: kw.error }, { status: 400 });
  config.targetKeywords = kw.value;

  // Validate include/exclude patterns BEFORE opening the stream so the
  // UI can show a clear inline error instead of a mid-audit failure.
  let includeRegexes: RegExp[];
  let excludeRegexes: RegExp[];
  try {
    includeRegexes = compileFilterPatterns(config.include);
    excludeRegexes = compileFilterPatterns(config.exclude);
  } catch (err) {
    if (err instanceof FilterPatternError) {
      return NextResponse.json(
        { error: `Invalid filter pattern "${err.pattern}": ${err.cause}`, pattern: err.pattern },
        { status: 400 },
      );
    }
    throw err;
  }

  // Build the renderer once, up-front. Both 'js' and 'auto' need
  // Browserless reachable up front — fail fast with a clear 502 rather
  // than letting an audit kick off and hit per-page failures.
  let renderer: Renderer;
  const ua = resolveUserAgent(config);
  const auth = buildBasicAuthHeader(config.basicAuth);
  const baseRendererOpts = {
    userAgent: ua,
    authHeader: auth,
    customHeaders: config.customHeaders,
  };

  if (config.rendering === 'js' || config.rendering === 'auto') {
    const endpoint = process.env.BROWSERLESS_ENDPOINT || 'ws://localhost:9223';
    const token = process.env.BROWSERLESS_TOKEN || '';
    if (!token) {
      return NextResponse.json(
        { error: `${config.rendering === 'js' ? 'JS' : 'Auto'} rendering requested but BROWSERLESS_TOKEN is not set on the server` },
        { status: 500 },
      );
    }
    const { JsRenderer, AutoRenderer, probeBrowserless } = await import('@/lib/renderer');
    const probe = await probeBrowserless(endpoint, token);
    if (!probe.ok) {
      return NextResponse.json(
        { error: `Browserless not reachable: ${probe.error}. Start the container in infra/browserless or fall back to rendering=static.` },
        { status: 502 },
      );
    }
    const jsRenderer = new JsRenderer({
      ...baseRendererOpts,
      endpoint,
      token,
      // Run axe-core on each page only when the user explicitly
      // selected the accessibility module. Adds ~1-2s per page.
      runAxe: config.modules.includes('accessibility'),
    });
    if (config.rendering === 'js') {
      renderer = jsRenderer;
    } else {
      // Auto-mode: compose a StaticRenderer for the first-pass + the
      // JsRenderer for escalation. AutoRenderer.fetch decides per page.
      renderer = new AutoRenderer(new StaticRenderer(baseRendererOpts), jsRenderer);
    }
  } else {
    renderer = new StaticRenderer(baseRendererOpts);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encodeSSE(event));
        } catch {
          // Controller already closed (client disconnected)
          closed = true;
        }
      };

      try {
        const result = await runAudit(config, send, includeRegexes, excludeRegexes, renderer);
        if (result) {
          send({ type: 'result', payload: result });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Audit error:', message);
        send({ type: 'error', message });
      } finally {
        // Ensure the renderer's resources (Browserless session) are
        // released even if the audit threw. StaticRenderer.close is a
        // no-op so the cost is zero in static mode.
        try { await renderer.close(); } catch { /* ignore */ }
        closed = true;
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ultimate-41: a budget setting that was not taken as given is named in the check log line
function withNote(o: CheckOutcome, note: { de: string; en: string } | undefined): CheckOutcome {
  if (!note) return o;
  return { ...o, summary_de: `${o.summary_de} ${note.de}`, summary_en: `${o.summary_en} ${note.en}` };
}

// ultimate-41: a whole positive number from the environment, else the default
function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number((raw ?? '').trim());
  return raw !== undefined && /^\d+$/.test(raw.trim()) && n > 0 ? n : fallback;
}
