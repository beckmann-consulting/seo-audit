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

import type { Browser, BrowserContext, Response as PWResponse } from 'playwright-core';
import type { Renderer, RenderResult, RendererOptions } from './types';
import { StaticRenderer } from './static';
import { countVisibleWords } from '../util/visible-text';

export interface JsRendererOptions extends RendererOptions {
  endpoint: string;       // ws://localhost:9223 (no trailing slash, no token)
  token: string;
  pageTimeoutMs?: number; // default 30000
  // Test seam: stub out the actual chromium.connect call.
  connect?: (wsEndpoint: string) => Promise<Browser>;
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
      r.staticHtml = staticOutcome.value.html;
      r.staticWordCount = countVisibleWords(staticOutcome.value.html);
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
      const navResp = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.pageTimeoutMs,
      });

      if (!navResp) {
        throw new Error(`page.goto returned null for ${url}`);
      }

      const html = await page.content();
      const finalUrl = page.url();

      // Build redirect chain: 3xx responses observed before the final URL.
      const chain: string[] = [];
      for (const r of responses) {
        if (r.url() === finalUrl) break;
        const status = r.status();
        if (status >= 300 && status < 400) chain.push(r.url());
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
      };
    } finally {
      await page.close().catch(() => { /* page may already be closed */ });
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

// Cheap connectivity probe used by the route handler before opening
// the SSE stream — if Browserless isn't reachable, we want to fail
// fast with a useful 4xx instead of a half-completed audit.
export async function probeBrowserless(
  endpoint: string,
  token: string,
  timeoutMs: number = 5000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // We hit the /health HTTP endpoint rather than opening a WebSocket;
  // that's both faster and doesn't consume one of the limited sessions.
  // Endpoint format: ws://host:port → http://host:port
  const httpEndpoint = endpoint
    .replace(/^ws:/i, 'http:')
    .replace(/^wss:/i, 'https:');
  try {
    const resp = await fetch(`${httpEndpoint}/health?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.ok) return { ok: true };
    return { ok: false, error: `Browserless returned ${resp.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
