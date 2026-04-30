// JsRenderer — connects to a Browserless container via WebSocket and
// drives a real Chromium for each page. Used when the audit opts into
// rendering=js. Static-mode users never load this file (the route
// handler imports it conditionally) so playwright-core only enters
// the runtime when actually needed.
//
// Connection model:
// - One Browser instance per audit (per JsRenderer lifetime).
// - One BrowserContext per audit, shared across all pages crawled in
//   that audit. Cookies / localStorage stay isolated between audits.
// - One Page per fetch(), closed when fetch() returns.
//
// Concurrency is enforced by Browserless server-side
// (MAX_CONCURRENT_SESSIONS=2). When all sessions are busy, our
// chromium.connect() call blocks until one is freed; the user-set
// timeout aborts hung connections.
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

export class JsRenderer implements Renderer {
  readonly mode = 'js' as const;
  private readonly staticRenderer: StaticRenderer;
  private readonly pageTimeoutMs: number;
  private browserPromise?: Promise<Browser>;
  private contextPromise?: Promise<BrowserContext>;

  constructor(private readonly opts: JsRendererOptions) {
    this.staticRenderer = new StaticRenderer(opts);
    this.pageTimeoutMs = opts.pageTimeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  }

  // Lazy connect — only on the first fetch. Errors propagate so the
  // caller can show a clear message ("Browserless not reachable").
  private async getContext(): Promise<BrowserContext> {
    if (this.contextPromise) return this.contextPromise;

    if (!this.browserPromise) {
      const ws = `${this.opts.endpoint}?token=${encodeURIComponent(this.opts.token)}`;
      const connect = this.opts.connect ?? (async (target: string) => {
        const { chromium } = await import('playwright-core');
        return chromium.connect(target);
      });
      this.browserPromise = connect(ws);
    }

    const browser = await this.browserPromise;
    const extraHTTPHeaders: Record<string, string> = {};
    if (this.opts.authHeader) extraHTTPHeaders['Authorization'] = this.opts.authHeader;
    if (this.opts.customHeaders) Object.assign(extraHTTPHeaders, this.opts.customHeaders);

    this.contextPromise = browser.newContext({
      userAgent: this.opts.userAgent,
      extraHTTPHeaders,
    });
    return this.contextPromise;
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
      // JS render failed entirely — re-throw so the crawler marks the
      // URL as broken. Static-only fallback would be confusing here:
      // the user explicitly opted into js mode.
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
    const ctx = await this.getContext();
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
      const navResp = await page.goto(url, {
        waitUntil: 'networkidle',
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
  // extra round-trips. Returns undefined on any failure — the audit
  // shouldn't break because Chromium hiccupped on a screenshot.
  async captureScreenshot(
    url: string,
    viewport: { width: number; height: number },
  ): Promise<string | undefined> {
    try {
      const ctx = await this.getContext();
      const page = await ctx.newPage();
      try {
        await page.setViewportSize(viewport);
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: this.pageTimeoutMs,
        });
        const buffer = await page.screenshot({ fullPage: false, type: 'png' });
        return Buffer.from(buffer).toString('base64');
      } finally {
        await page.close().catch(() => { /* page may already be closed */ });
      }
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    // Best-effort close — never let cleanup errors poison the audit.
    if (this.contextPromise) {
      try { await (await this.contextPromise).close(); } catch { /* ignore */ }
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
