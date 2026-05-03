// JsRenderer — connects to a Browserless v2 container over CDP (Chrome
// DevTools Protocol) and drives a real Chromium for each page. Used
// when the audit opts into rendering=js. Static-mode users never load
// this file (the route handler imports it conditionally) so playwright-
// core only enters the runtime when actually needed.
//
// Why connectOverCDP and not connect? Browserless v2's WebSocket
// endpoint speaks CDP — the version-agnostic wire protocol. Playwright's
// native `connect()` expects a /playwright endpoint plus a strict
// playwright-core ↔ Chromium version match, which we cannot guarantee
// across upgrades of either side. `connectOverCDP()` is what the
// Browserless docs recommend for this exact setup.
//
// Connection model:
// - One Browser instance per audit (per JsRenderer lifetime).
// - One BrowserContext per audit, shared across all pages crawled in
//   that audit. Cookies / localStorage stay isolated between audits.
// - One Page per fetch(), closed when fetch() returns.
//
// Concurrency is enforced by Browserless server-side
// (MAX_CONCURRENT_SESSIONS=2). When all sessions are busy, our
// chromium.connectOverCDP() call blocks until one is freed; the
// user-set timeout aborts hung connections.
//
// Each fetch also runs the StaticRenderer in parallel — the static
// HTML is captured for the static-vs-rendered diff that drives the
// js-rendering-required finding. Static fetch is cheap (~100-200ms)
// compared to the JS render (~2-5s) so the parallel cost is rounding
// error.

import type { Browser, BrowserContext, Page, Response as PWResponse } from 'playwright-core';
import type { Renderer, RenderResult, RendererOptions } from './types';
import type { AxeViolation, HttpError } from '@/types';
import { StaticRenderer } from './static';
import { countVisibleWords } from '../util/visible-text';
import { computeRenderDiff } from '../util/render-diff';

export interface JsRendererOptions extends RendererOptions {
  endpoint: string;       // ws://localhost:9223 (no trailing slash, no token)
  token: string;
  pageTimeoutMs?: number; // default 30000
  // When true, axe-core runs after the page renders and the resulting
  // violations are attached to RenderResult.axeViolations. Adds ~1-2s
  // per page; only enable when the accessibility module is selected.
  runAxe?: boolean;
  // Test seam: stub out the actual chromium.connect call.
  connect?: (wsEndpoint: string) => Promise<Browser>;
  // Test seam: stub the axe runner so we don't ship axe-core through
  // a stub Playwright in unit tests. Production wiring uses the real
  // @axe-core/playwright AxeBuilder.
  axeRunner?: (page: Page) => Promise<AxeViolation[]>;
}

const DEFAULT_PAGE_TIMEOUT_MS = 30_000;

// Tighter goto budget for the screenshot path. The crawl render needs
// the longer timeout because it has to capture the actual content for
// SEO analysis; a screenshot just needs whatever painted to disk, so
// we cap navigation at 15s and fall through to the screenshot even if
// goto throws (see captureScreenshot).
const SCREENSHOT_GOTO_TIMEOUT_MS = 15_000;

// Brief wait between DOMContentLoaded and the screenshot click so
// fonts and above-the-fold async content (hero images, lazy-loaded
// font swaps) get one chance to paint before the buffer is taken.
// 2s is the empirical sweet spot — long enough for typical hero
// content, short enough that 4 pages × 2 viewports adds ~16s total
// even if every page hits this branch.
const SCREENSHOT_PAINT_SETTLE_MS = 2_000;

export class JsRenderer implements Renderer {
  readonly mode = 'js' as const;
  private readonly staticRenderer: StaticRenderer;
  private readonly pageTimeoutMs: number;
  private browserPromise?: Promise<Browser>;
  // Two distinct contexts — one for the crawl pass, one for screenshots.
  // Pre-fix the renderer reused a single shared context for the entire
  // audit. Browserless's CONNECTION_TIMEOUT (default 30s) tore down the
  // session during the gap between crawl-end and screenshot-start
  // (filled by sequential PSI / SSL Labs / Bing API calls). Every
  // screenshot then failed with "browserContext.newPage: Target page,
  // context or browser has been closed". By creating the screenshot
  // context lazily on FIRST captureScreenshot call, we guarantee a
  // fresh session at the moment screenshots actually run.
  private crawlContext: BrowserContext | null = null;
  private screenshotContext: BrowserContext | null = null;

  constructor(private readonly opts: JsRendererOptions) {
    this.staticRenderer = new StaticRenderer(opts);
    this.pageTimeoutMs = opts.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  }

  // Connect lazily on the first context request. Errors propagate so
  // the caller can show a clear message ("Browserless not reachable").
  private async createContext(): Promise<BrowserContext> {
    if (!this.browserPromise) {
      const ws = `${this.opts.endpoint}?token=${encodeURIComponent(this.opts.token)}`;
      const connect = this.opts.connect ?? (async (target: string) => {
        const { chromium } = await import('playwright-core');
        return chromium.connectOverCDP(target);
      });
      this.browserPromise = connect(ws);
    }

    const browser = await this.browserPromise;
    const extraHTTPHeaders: Record<string, string> = {};
    if (this.opts.authHeader) extraHTTPHeaders['Authorization'] = this.opts.authHeader;
    if (this.opts.customHeaders) Object.assign(extraHTTPHeaders, this.opts.customHeaders);

    return browser.newContext({
      userAgent: this.opts.userAgent,
      extraHTTPHeaders,
    });
  }

  private async getCrawlContext(): Promise<BrowserContext> {
    if (this.crawlContext) return this.crawlContext;
    this.crawlContext = await this.createContext();
    return this.crawlContext;
  }

  private async getScreenshotContext(): Promise<BrowserContext> {
    if (this.screenshotContext) return this.screenshotContext;
    this.screenshotContext = await this.createContext();
    return this.screenshotContext;
  }

  async fetch(url: string): Promise<RenderResult> {
    // Run static probe and JS render in parallel. The static side feeds
    // the js-rendering-required diff; the JS side is what the audit
    // pipeline reads as "the HTML".
    const [staticOutcome, jsResult] = await Promise.allSettled([
      this.staticRenderer.fetch(url),
      this.fetchWithBrowser(url),
    ]).then(([s, j]) => [s, j] as const);

    if (jsResult.status === 'rejected') {
      // JS render failed (typical: page.goto timeout because heavy
      // 3rd-party scripts never let the page reach networkidle/load).
      // If the parallel static probe succeeded with usable HTML, fall
      // back to that result — the URL is reachable, only the JS render
      // didn't complete. The jsRenderFailed flag tells the crawler to
      // record the URL in renderFailed[] (NOT brokenLinks) so the
      // distinction shows up in the report. Re-throw only when both
      // static and JS failed: that's a real unreachable URL.
      const reason = jsResult.reason instanceof Error ? jsResult.reason.message : String(jsResult.reason);
      if (staticOutcome.status === 'fulfilled' && staticOutcome.value.status > 0 && staticOutcome.value.html) {
        const staticResult = staticOutcome.value;
        return {
          ...staticResult,
          // mode stays 'static' — downstream code that gates on mode
          // for JS-only data (axeViolations, renderTimeMs etc.) skips
          // this page automatically, which is what we want.
          jsRenderFailed: { reason },
        };
      }
      throw jsResult.reason;
    }

    const r = jsResult.value;
    if (staticOutcome.status === 'fulfilled' && staticOutcome.value.html) {
      const staticHtml = staticOutcome.value.html;
      const staticWordCount = countVisibleWords(staticHtml);
      r.staticHtml = staticHtml;
      r.staticWordCount = staticWordCount;
      // E4: compute the diff once, here, where we have both HTMLs.
      // Only set when we actually have a static body to compare; if
      // the static fetch came back with html='' it's not a useful diff.
      r.staticVsRenderedDiff = computeRenderDiff(staticHtml, staticWordCount, r.html);
    }
    return r;
  }

  private async fetchWithBrowser(url: string): Promise<RenderResult> {
    const start = Date.now();
    const ctx = await this.getCrawlContext();
    const page = await ctx.newPage();

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const responses: PWResponse[] = [];

    page.on('pageerror', err => consoleErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('requestfailed', req => {
      const failure = req.failure();
      failedRequests.push(`${req.url()}: ${failure?.errorText ?? 'unknown'}`);
    });
    page.on('response', resp => responses.push(resp));

    try {
      // E4: renderTimeMs covers only goto + content — the actual
      // Browserless render. loadTimeMs (further down) covers the
      // whole fetch including axe so the two metrics measure
      // different things on purpose.
      const renderStart = Date.now();
      // 'load' waits for window.load — primary HTML + main subresources
      // settled. Switched away from 'networkidle' (= 500ms of network
      // silence) because heavy 3rd-party trackers / Webflow animation
      // runtimes / chat embeds keep firing background requests forever
      // and the page never reached idle within the 30s budget. 'load'
      // misses lazy-loaded below-the-fold content, but most SEO-relevant
      // markup is above the fold or rendered synchronously, and the
      // diff vs 'networkidle' is far less destructive than every
      // such page being reported as broken.
      const navResp = await page.goto(url, {
        waitUntil: 'load',
        timeout: this.pageTimeoutMs,
      });

      if (!navResp) {
        throw new Error(`page.goto returned null for ${url}`);
      }

      const html = await page.content();
      const renderTimeMs = Date.now() - renderStart;
      const finalUrl = page.url();
      // axe runs AFTER content capture so the page DOM is what users
      // see, not what's loading. Failures are swallowed — a flaky axe
      // run shouldn't tank the whole audit.
      let axeViolations: AxeViolation[] | undefined;
      if (this.opts.runAxe) {
        try {
          const runner = this.opts.axeRunner ?? defaultAxeRunner;
          axeViolations = await runner(page);
        } catch {
          axeViolations = undefined;
        }
      }

      // Build redirect chain: 3xx responses observed before the final URL.
      const chain: string[] = [];
      for (const r of responses) {
        if (r.url() === finalUrl) break;
        const status = r.status();
        if (status >= 300 && status < 400) chain.push(r.url());
      }

      // E4.5: HTTP 4xx/5xx errors for sub-resources. The main-page
      // response is excluded — its status lives on RenderResult.status,
      // duplicating it here would just inflate the count. Resource type
      // comes from request().resourceType() (Playwright's classifier).
      const httpErrors: HttpError[] = [];
      for (const r of responses) {
        if (r.url() === finalUrl) continue;
        const status = r.status();
        if (status < 400 || status >= 600) continue;
        let resourceType = 'other';
        try {
          resourceType = r.request().resourceType();
        } catch {
          /* request may already be GC'd; fall back to 'other' */
        }
        httpErrors.push({ url: r.url(), status, resourceType });
      }

      // Lowercased headers from the final response.
      const headersObj: Record<string, string> = {};
      for (const [name, value] of Object.entries(navResp.headers())) {
        headersObj[name.toLowerCase()] = value;
      }

      return {
        url,
        finalUrl,
        status: navResp.status(),
        contentType: headersObj['content-type'],
        headers: headersObj,
        html,
        redirectChain: chain,
        loopDetected: false,
        loadTimeMs: Date.now() - start,
        protocol: null,
        mode: 'js',
        consoleErrors,
        failedRequests,
        axeViolations,
        renderTimeMs,
        httpErrors,
      };
    } finally {
      await page.close().catch(() => { /* page may already be closed */ });
    }
  }

  // Capture a screenshot of `url` at the given viewport. Used by E2
  // for the optional PDF screenshot section. Returns a base64-encoded
  // PNG so the result can be embedded directly in jsPDF without
  // extra round-trips. Returns undefined on context/page/screenshot
  // failure — but a navigation timeout no longer aborts: we fall
  // through and screenshot whatever the page rendered before the
  // timeout, which on Webflow / Calendly-laden pages is typically
  // a usable above-the-fold capture.
  //
  // Reasoning for waitUntil='domcontentloaded' vs the crawl's 'load':
  // the crawl needs the actual page content for SEO analysis, so it
  // waits for window.load. Screenshots only need the DOM rendered;
  // 'domcontentloaded' fires after HTML+CSS+inline JS, typically
  // 1-3s on real-world sites, vs window.load which on Webflow agency
  // sites (Calendly/HubSpot iframes) regularly takes >30s or never
  // fires. Combined with the partial-capture fallback below, this
  // turns the failure mode from "no screenshot" into "approximate
  // above-the-fold screenshot".
  async captureScreenshot(
    url: string,
    viewport: { width: number; height: number },
  ): Promise<string | undefined> {
    // Inner attempt: takes a context, runs the full goto + screenshot
    // path against it. Used twice — once with the cached screenshot
    // context, and (only if Browserless reports the context is dead)
    // once more with a freshly-created replacement.
    const attempt = async (ctx: BrowserContext): Promise<string> => {
      const page = await ctx.newPage();
      try {
        await page.setViewportSize(viewport);
        // Inner try/catch around goto so a navigation timeout doesn't
        // skip the screenshot — Playwright lets us capture whatever
        // state the page reached. We log the timeout (warn level so
        // it's visible in journalctl without flooding the log) but
        // proceed to the paint-settle wait + screenshot.
        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: SCREENSHOT_GOTO_TIMEOUT_MS,
          });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`[screenshot] goto timeout, attempting partial capture: url=${url} viewport=${viewport.width}x${viewport.height} reason=${reason}`);
        }
        await page.waitForTimeout(SCREENSHOT_PAINT_SETTLE_MS);
        const buffer = await page.screenshot({ fullPage: false, type: 'png' });
        return Buffer.from(buffer).toString('base64');
      } finally {
        await page.close().catch(() => { /* page may already be closed */ });
      }
    };

    try {
      const ctx = await this.getScreenshotContext();
      return await attempt(ctx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Self-heal Browserless's "session timed out" failure mode: drop
      // the cached screenshot context, recreate, retry exactly once.
      // Other failures (encoding, real timeout) don't retry — they're
      // not recoverable by another attempt.
      if (reason.includes('Target page, context or browser has been closed')) {
        console.warn(`[screenshot] context closed, recreating: url=${url}`);
        this.screenshotContext = null;
        try {
          const ctx = await this.getScreenshotContext();
          return await attempt(ctx);
        } catch (retryErr) {
          const retryReason = retryErr instanceof Error ? retryErr.message : String(retryErr);
          console.error(`[screenshot] failed after retry: url=${url} viewport=${viewport.width}x${viewport.height} reason=${retryReason}`);
          return undefined;
        }
      }
      // Reaches here on context-creation failure, newPage rejection
      // (Browserless overload non-context-closed), setViewportSize
      // errors, or screenshot encoding failures.
      console.error(`[screenshot] failed: url=${url} viewport=${viewport.width}x${viewport.height} reason=${reason}`);
      return undefined;
    }
  }

  async close(): Promise<void> {
    // Best-effort close — never let cleanup errors poison the audit.
    // Both contexts get closed independently (either may be null if
    // its pass never ran for this audit).
    if (this.crawlContext) {
      try { await this.crawlContext.close(); } catch { /* ignore */ }
      this.crawlContext = null;
    }
    if (this.screenshotContext) {
      try { await this.screenshotContext.close(); } catch { /* ignore */ }
      this.screenshotContext = null;
    }
    if (this.browserPromise) {
      try { await (await this.browserPromise).close(); } catch { /* ignore */ }
    }
  }
}

// The default axe runner: dynamically loads @axe-core/playwright,
// runs against WCAG 2.0 + 2.1 levels A and AA, and projects the
// verbose AxeBuilder result into our compact AxeViolation shape.
// Dynamic import keeps the dependency lazy — static-mode audits
// never load it.
async function defaultAxeRunner(page: Page): Promise<AxeViolation[]> {
  const mod = await import('@axe-core/playwright');
  const AxeBuilder = (mod as { default?: typeof import('@axe-core/playwright').default }).default
    ?? (mod as unknown as typeof import('@axe-core/playwright').default);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations.map(v => ({
    id: v.id,
    impact: v.impact ?? null,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    tags: v.tags,
    nodes: v.nodes.length,
  }));
}

// Cheap connectivity probe used by the route handler before opening
// the SSE stream — if Browserless isn't reachable, we want to fail
// fast with a useful 4xx instead of a half-completed audit.
export async function probeBrowserless(
  endpoint: string,
  token: string,
  timeoutMs: number = 5000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // We hit the /pressure HTTP endpoint rather than opening a WebSocket;
  // that's both faster and doesn't consume one of the limited sessions.
  // Endpoint format: ws://host:port → http://host:port
  const httpEndpoint = endpoint
    .replace(/^ws:/i, 'http:')
    .replace(/^wss:/i, 'https:');
  try {
    const resp = await fetch(`${httpEndpoint}/pressure?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.ok) return { ok: true };
    return { ok: false, error: `Browserless returned ${resp.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
