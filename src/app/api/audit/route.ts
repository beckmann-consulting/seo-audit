import { NextRequest, NextResponse } from 'next/server';
import { crawlSite } from '@/lib/crawler';
import { extractPageSEO } from '@/lib/extractor';
import {
  checkSSL, checkDNS, checkPageSpeed,
  checkSafeBrowsing, checkRobotsAndSitemap, checkSecurityHeaders,
  checkAIReadiness, fetchSitemap, checkWwwConsistency,
} from '@/lib/external-checks';
import { checkImageSizes } from '@/lib/external-image-sizes';
import { checkMobileDesktopParity } from '@/lib/external-mobile-desktop-parity';
import {
  generateSEOFindings, generateContentFindings, generateTechFindings,
  generateLegalFindings, generateUXFindings, generatePerformanceFindings,
  generateSafeBrowsingFindings, generateSecurityHeadersFindings,
  generateHreflangFindings, generateAIReadinessFindings,
  generateStructuredDataFindings, generateDuplicateContentFindings,
  generateCrawlStructureFindings, generateClientRenderingFindings,
  generateSitemapCoverageFindings, generateRedirectFindings,
  generateAnchorTextFindings, generateRobotsConflictFindings,
  generateOpenGraphFindings, generateSitemapQualityFindings,
  generateRichResultsFindings, generateImageDetailFindings,
  generateBodyDuplicateFindings, generateTextHtmlRatioFindings,
  generateReadabilityFindings, generateOversizedImageFindings,
  generateAccessibilityFindings, generateGscFindings,
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
import { resolveUserAgent, getRobotsToken } from '@/lib/util/user-agents';
import { compileFilterPatterns, FilterPatternError } from '@/lib/util/url-filter';
import { buildBasicAuthHeader, sanitizeConfigForClient } from '@/lib/util/auth';
import { StaticRenderer } from '@/lib/renderer';
import type { JsRenderer, Renderer } from '@/lib/renderer';
import { captureScreenshotsForAudit } from '@/lib/screenshots';
import { resolveGscResult, emitGscWarning } from '@/lib/external-gsc/route-helper';
import type { GscResult, StreamEvent } from '@/types';
import type { AuditConfig, AuditResult, ModuleScore, Module, Finding } from '@/types';

export const maxDuration = 300; // 5 min timeout

const MODULE_LABELS: Record<Module, { de: string; en: string }> = {
  seo: { de: 'SEO', en: 'SEO' },
  content: { de: 'Inhalte', en: 'Content' },
  legal: { de: 'Rechtliches', en: 'Legal' },
  ux: { de: 'UX & Struktur', en: 'UX & Structure' },
  tech: { de: 'Technik', en: 'Tech' },
  performance: { de: 'Performance', en: 'Performance' },
  accessibility: { de: 'Barrierefreiheit', en: 'Accessibility' },
  offers: { de: 'Angebote', en: 'Offers' },
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

  // ---- STEP 1: DNS (5%) ----
  progress('dns_check', 5);
  const dnsInfo = config.modules.includes('tech') ? await checkDNS(domain) : undefined;

  // ---- STEP 2: SSL (10%) ----
  progress('ssl_check', 10);
  const sslInfo = config.modules.includes('tech') ? await checkSSL(domain) : undefined;

  // ---- STEP 3: robots.txt (15%) ----
  progress('robots_fetch', 15);
  const { hasRobots, hasSitemap, robotsContent, sitemapUrl } = await checkRobotsAndSitemap(url, userAgent, authHeader, customHeaders);

  // ---- STEP 4: sitemap.xml (20%) ----
  progress('sitemap_fetch', 20);
  const sitemapInfo = (hasSitemap && sitemapUrl && config.modules.includes('seo'))
    ? await fetchSitemap(sitemapUrl, userAgent, authHeader, customHeaders)
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

  // ---- STEP 7: Security Headers (80%) ----
  progress('security_headers', 80);
  const securityHeaders = config.modules.includes('tech')
    ? await checkSecurityHeaders(url, rawPages[0]?.html, userAgent, authHeader, customHeaders)
    : undefined;

  // ---- STEP 7b: www / non-www consistency ----
  const wwwConsistency = config.modules.includes('tech')
    ? await checkWwwConsistency(url, userAgent, authHeader, customHeaders)
    : undefined;

  // ---- STEP 8: AI Crawler Readiness (85%) ----
  progress('ai_crawler_check', 85);
  const aiReadiness = config.modules.includes('seo')
    ? await checkAIReadiness(url, robotsContent, userAgent, authHeader, customHeaders)
    : undefined;

  // ---- STEP 8b: Image-size HEAD probes ----
  // Default 20 unique images probed; user can disable by setting 0.
  const imageProbeLimit = config.imageHeadCheckLimit ?? 20;
  const imageSizes = (imageProbeLimit > 0 && config.modules.includes('content'))
    ? await checkImageSizes(pages, imageProbeLimit, userAgent, authHeader, customHeaders)
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
  const screenshots = (config.includeScreenshots && config.rendering === 'js')
    ? await captureScreenshotsForAudit(renderer as JsRenderer, pages)
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

  // ---- STEP 9: Findings generation (90%) ----
  progress('findings_generation', 90);
  const allHtml = rawPages.map(p => p.html).join('\n');
  const allFindings: Finding[] = [];

  if (config.modules.includes('seo')) {
    allFindings.push(...generateSEOFindings(pages, hasRobots, hasSitemap));
    allFindings.push(...generateHreflangFindings(pages));
    allFindings.push(...generateAIReadinessFindings(aiReadiness));
    allFindings.push(...generateStructuredDataFindings(pages));
    allFindings.push(...generateDuplicateContentFindings(pages));
    allFindings.push(...generateCrawlStructureFindings(pages));
    allFindings.push(...generateSitemapCoverageFindings(pages, sitemapInfo));
    allFindings.push(...generateAnchorTextFindings(pages));
    allFindings.push(...generateRobotsConflictFindings(pages, robotsContent, sitemapInfo, robotsBotToken));
    allFindings.push(...generateOpenGraphFindings(pages));
    allFindings.push(...generateSitemapQualityFindings(sitemapInfo, url));
    allFindings.push(...generateRichResultsFindings(pages, pageSpeedData));
    allFindings.push(...generateURLQualityFindings(pages));
    allFindings.push(...generateXRobotsFindings(pages));
    allFindings.push(...generatePixelWidthFindings(pages));
    allFindings.push(...generateMixedStructuredDataFindings(pages));
    allFindings.push(...generateMobileDesktopParityFindings(mobileDesktopParity));
    allFindings.push(...generateGscFindings(pages, gscResult, sitemapInfo));
  }
  if (config.modules.includes('content')) {
    allFindings.push(...generateContentFindings(pages));
    allFindings.push(...generateImageDetailFindings(pages));
    allFindings.push(...generateBodyDuplicateFindings(pages));
    allFindings.push(...generateTextHtmlRatioFindings(pages));
    allFindings.push(...generateReadabilityFindings(pages));
    allFindings.push(...generateOversizedImageFindings(imageSizes));
  }
  if (config.modules.includes('tech')) {
    allFindings.push(...generateTechFindings(pages, crawlStats, sslInfo, dnsInfo));
    allFindings.push(...generateSecurityHeadersFindings(securityHeaders));
    allFindings.push(...generateClientRenderingFindings(pages));
    allFindings.push(...generateRedirectFindings(pages, url));
    allFindings.push(...generateThirdPartyScriptFindings(pages));
    allFindings.push(...generateWwwConsistencyFindings(wwwConsistency));
    allFindings.push(...generateInsecureLinkFindings(pages));
    allFindings.push(...generateJsRenderingFindings(pages));
  }
  if (config.modules.includes('legal')) {
    allFindings.push(...generateLegalFindings(pages, allHtml));
  }
  if (config.modules.includes('ux')) {
    allFindings.push(...generateUXFindings(pages));
    allFindings.push(...generateFontLoadingFindings(pages));
    allFindings.push(...generateFaviconFindings(pages));
    allFindings.push(...generateTouchTargetFindings(pages));
  }
  if (config.modules.includes('performance')) {
    allFindings.push(...generatePerformanceFindings(pageSpeedData, pages));
  }
  if (safeBrowsingData) {
    allFindings.push(...generateSafeBrowsingFindings(safeBrowsingData));
  }
  // Accessibility runs as its own module — generates findings whenever
  // the user picked the module, even in static mode (where it just
  // emits the "JS-mode required" guidance finding).
  allFindings.push(...generateAccessibilityFindings(pages, config.modules.includes('accessibility')));

  // ---- Scores ----
  const moduleScores: ModuleScore[] = config.modules.map(m => ({
    module: m,
    score: calculateModuleScore(allFindings, m),
    label_de: MODULE_LABELS[m].de,
    label_en: MODULE_LABELS[m].en,
  }));

  if (pageSpeedData?.seoScore) {
    const seoModule = moduleScores.find(m => m.module === 'seo');
    if (seoModule) {
      seoModule.score = Math.round((seoModule.score + pageSpeedData.seoScore) / 2);
    }
  }

  const totalScore = moduleScores.length > 0
    ? Math.round(moduleScores.reduce((s, m) => s + m.score, 0) / moduleScores.length)
    : 50;

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
  if (crawlStats.brokenLinks.length === 0) {
    strengths_de.push('Keine defekten Links gefunden — saubere Link-Struktur.');
    strengths_en.push('No broken links found — clean link structure.');
  }
  if (strengths_de.length < 3) {
    strengths_de.push(`${crawlStats.crawledPages} Seiten erfolgreich gecrawlt.`);
    strengths_en.push(`${crawlStats.crawledPages} pages successfully crawled.`);
  }

  // ---- Summary ----
  const criticalCount = allFindings.filter(f => f.priority === 'critical').length;
  const importantCount = allFindings.filter(f => f.priority === 'important').length;
  const scoreLabel_de = totalScore >= 75 ? 'gut' : totalScore >= 50 ? 'verbesserungswürdig' : 'kritisch';
  const scoreLabel_en = totalScore >= 75 ? 'good' : totalScore >= 50 ? 'needs improvement' : 'critical';

  const summary_de = `${domain} erreicht einen Gesamt-SEO-Score von ${totalScore}/100 (${scoreLabel_de}). Es wurden ${crawlStats.crawledPages} Seiten gecrawlt und ${allFindings.length} Findings identifiziert — davon ${criticalCount} kritische und ${importantCount} wichtige. ${criticalCount > 0 ? 'Die kritischen Punkte sollten sofort behoben werden.' : 'Die wichtigsten Verbesserungspotenziale liegen in den unten aufgeführten Empfehlungen.'}`;
  const summary_en = `${domain} achieves an overall SEO score of ${totalScore}/100 (${scoreLabel_en}). ${crawlStats.crawledPages} pages were crawled and ${allFindings.length} findings were identified — ${criticalCount} critical and ${importantCount} important. ${criticalCount > 0 ? 'The critical issues should be addressed immediately.' : 'The main improvement potential lies in the recommendations listed below.'}`;

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
    aiReadiness,
    sitemapInfo,
    wwwConsistency,
    pages,
    imageSizes,
    mobileDesktopParity,
    screenshots,
    gscResult,
    topFindings: getTopFindings(allFindings, 5),
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
