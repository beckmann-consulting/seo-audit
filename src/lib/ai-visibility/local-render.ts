// The local render of check 5, for audits without Browserless: a Chromium
// (AI_LOCAL_CHROMIUM, no download) that opens no connection of its own.
//
// - Every request of the page is caught by context.route and answered from
//   safeFetch (the audited host and further hosts of its registrable domain,
//   public pinned addresses); WebSockets are
//   closed; anything that could slip past the routing meets a resolver that
//   maps every host to nothing and a dead proxy.
// - The document's redirects are resolved in Node first; Chromium then
//   navigates straight to the final URL, so location, relative URLs and
//   cookies are right.
// - A page counts only if every one of its requests was served in full. One
//   blocked, failed, redirected or limited request makes it "incomplete":
//   check 5 then does not assess it, in either direction.
// - The DOM is taken after a quiet phase: no request running and no change
//   to nodes, text or the head attributes the head comparison reads, for
//   QUIET_MS; not quiet within the page budget means incomplete.
// - The browser is closed in finally; Playwright's temporary profile goes
//   with it.

import type { Browser, Page } from 'playwright-core';
import { buildScope, admit, safeFetch, CookieJar, DEFAULT_LIMITS, type Limits, type Scope, type Transport } from './safe-fetch';
import type { LocalRenderOutcome } from './index';

export const LOCAL_RENDER_SAMPLE = 5; // the start page and up to 4 more
export const QUIET_MS = 1000;

export const CHROMIUM_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND',
  '--proxy-server=127.0.0.1:9',
  '--proxy-bypass-list=<-loopback>',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-sync',
  '--no-pings',
  '--dns-prefetch-disable',
  '--no-first-run',
  '--disable-default-apps',
  '--disable-extensions',
];

// counts the last change to nodes, text, or the head attributes the head comparison reads
const OBSERVER = `(() => {
  window.__aivLastMutation = Date.now();
  const HEAD_TAGS = new Set(['LINK', 'META', 'HTML', 'TITLE']);
  const obs = new MutationObserver(records => {
    for (const r of records) {
      if (r.type !== 'attributes' || (r.target && HEAD_TAGS.has(r.target.nodeName))) {
        window.__aivLastMutation = Date.now();
        return;
      }
    }
  });
  obs.observe(document, { childList: true, characterData: true, subtree: true, attributes: true,
    attributeFilter: ['rel', 'href', 'hreflang', 'name', 'content', 'lang'] });
})();`;

export interface LocalRenderOptions {
  executablePath: string;
  auditUrl: string;
  urls: string[];
  auditHeaders?: Record<string, string>;
  transport?: Transport; // tests only
  limits?: Limits;
  quietMs?: number;
}

function hostOf(u: string): string {
  try { return new URL(u).host; } catch { return u; }
}

/** A promise that rejects at the page's deadline, whatever the page's renderer does. */
function beforeDeadline<T>(p: Promise<T>, deadline: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('page over its time budget')), Math.max(1, deadline - Date.now()));
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

async function renderOne(browser: Browser, url: string, scope: Scope, o: LocalRenderOptions): Promise<LocalRenderOutcome> {
  const limits = o.limits ?? DEFAULT_LIMITS;
  const quietMs = o.quietMs ?? QUIET_MS;
  const budget = { bytesLeft: limits.pageBytes, deadline: Date.now() + limits.pageTimeMs };
  let incomplete: string | undefined;
  const mark = (reason: string) => { if (!incomplete) incomplete = reason; };

  // the document's redirect chain with a cookie jar: each step gets the cookies of the steps before
  const jar = new CookieJar();
  const doc = await safeFetch(url, { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml' } },
    { scope, transport: o.transport, limits, budget, document: true, auditHeaders: o.auditHeaders, jar });
  if (!doc.ok) return { incompleteReason: `document: ${doc.reason}` };
  if (doc.res.status >= 400) return { incompleteReason: `document: HTTP ${doc.res.status}` };
  const finalUrl = doc.res.finalUrl;

  const ua = Object.entries(o.auditHeaders ?? {}).find(([k]) => k.toLowerCase() === 'user-agent')?.[1];
  const context = await browser.newContext({ serviceWorkers: 'block', ...(ua ? { userAgent: ua } : {}) });
  let page: Page | undefined;
  // a watchdog independent of the page: a renderer that blocks its main thread after load cannot keep
  // page.evaluate or page.content waiting past the deadline; the context is closed then
  const watchdog = setTimeout(() => { mark('page over its time budget (watchdog)'); context.close().catch(() => {}); }, Math.max(1, budget.deadline - Date.now()) + 1000);
  try {
    if (jar.size > 0) await context.addCookies(jar.forPlaywright());
    page = await context.newPage();
    const main = page;
    context.on('page', p => { if (p !== main) p.close().catch(() => {}); }); // popups
    await context.routeWebSocket(/.*/, ws => { mark('WebSocket blocked'); ws.close().catch(() => {}); });
    let requests = 0;
    let inflight = 0;
    let lastNet = Date.now();
    let docServed = false;
    await context.route('**/*', async route => {
      const req = route.request();
      if (req.frame().page() !== main) { await route.abort('blockedbyclient').catch(() => {}); return; }
      inflight++;
      lastNet = Date.now();
      try {
        if (!docServed && req.isNavigationRequest() && req.url() === finalUrl) {
          docServed = true;
          await route.fulfill({ status: doc.res.status, headers: doc.res.headers, body: doc.res.body });
          return;
        }
        if (req.isNavigationRequest() && req.frame() === main.mainFrame()) {
          mark(`the page navigated away (${req.url()})`);
          await route.abort('blockedbyclient');
          return;
        }
        if (++requests > limits.pageRequests) {
          mark(`more than ${limits.pageRequests} requests`);
          await route.abort('blockedbyclient');
          return;
        }
        const allowed = await admit(scope, req.url(), budget.deadline);
        if (!allowed.ok) {
          mark(`request to another host blocked (${hostOf(req.url())}: ${allowed.reason})`);
          await route.abort('blockedbyclient');
          return;
        }
        const method = req.method();
        let body: Buffer | undefined;
        if (method === 'POST') {
          const b = req.postDataBuffer();
          if (!b) { mark('POST without a readable body'); await route.abort('blockedbyclient'); return; }
          body = b;
        }
        let headers: Record<string, string>;
        try { headers = await req.allHeaders(); } catch { mark('request headers not readable'); await route.abort('blockedbyclient'); return; }
        const r = await safeFetch(req.url(), { method, headers, body }, { scope, transport: o.transport, limits, budget, document: false, auditHeaders: o.auditHeaders });
        if (!r.ok) { mark(r.reason); await route.abort('blockedbyclient'); return; }
        if (r.res.status >= 400) mark(`HTTP ${r.res.status} for ${req.url()}`);
        await route.fulfill({ status: r.res.status, headers: r.res.headers, body: r.res.body });
      } catch (err) {
        mark(`routing failed: ${String((err as Error).message ?? err)}`);
        await route.abort('failed').catch(() => {});
      } finally {
        inflight--;
        lastNet = Date.now();
      }
    });
    main.on('requestfailed', req => mark(`request failed: ${req.url()} (${req.failure()?.errorText ?? 'unknown'})`));
    await main.addInitScript(OBSERVER);
    await main.goto(finalUrl, { waitUntil: 'load', timeout: Math.max(1, budget.deadline - Date.now()) });
    for (;;) {
      if (Date.now() > budget.deadline) { mark('not quiet within the time budget'); break; }
      const lastMutation = await beforeDeadline(main.evaluate(() => (window as unknown as { __aivLastMutation?: number }).__aivLastMutation ?? 0), budget.deadline);
      const now = Date.now();
      if (inflight === 0 && now - lastNet >= quietMs && now - lastMutation >= quietMs) break;
      await main.waitForTimeout(100);
    }
    const renderedHtml = await beforeDeadline(main.content(), budget.deadline + 1000);
    return incomplete ? { renderedHtml, incompleteReason: incomplete } : { renderedHtml };
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    const late = Date.now() >= budget.deadline - 500 || /timeout/i.test(msg);
    return { incompleteReason: incomplete ?? (late ? `page over its time budget (${msg.split('\n')[0]})` : `render failed: ${msg}`) };
  } finally {
    clearTimeout(watchdog);
    // closing must not hang either; the browser is closed in localRender's finally in any case
    await beforeDeadline(context.close(), Date.now() + 5000).catch(() => {});
  }
}

/** Render a sample of pages locally; every page gets an outcome, a failure of the whole run included. */
export async function localRender(o: LocalRenderOptions): Promise<Map<string, LocalRenderOutcome>> {
  const out = new Map<string, LocalRenderOutcome>();
  // the local render may load from further hosts of the audited host's registrable domain (ultimate-40b)
  const scope = await buildScope(o.auditUrl, o.transport, { subdomains: true, requestTimeoutMs: (o.limits ?? DEFAULT_LIMITS).requestTimeoutMs });
  if (!scope.ok) {
    for (const u of o.urls) out.set(u, { incompleteReason: scope.reason });
    return out;
  }
  let browser: Browser | undefined;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({ executablePath: o.executablePath, headless: true, args: CHROMIUM_ARGS });
    for (const u of o.urls) out.set(u, await renderOne(browser, u, scope.scope, o));
  } catch (err) {
    for (const u of o.urls) if (!out.has(u)) out.set(u, { incompleteReason: `local Chromium failed: ${String((err as Error).message ?? err)}` });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return out;
}
