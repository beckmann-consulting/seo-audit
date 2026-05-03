import { describe, it, expect, vi, afterEach } from 'vitest';
import { JsRenderer, probeBrowserless } from './js';

afterEach(() => { vi.restoreAllMocks(); });

// ============================================================
//  Lightweight stubs for the Playwright API surface JsRenderer uses.
//  We only model the shape needed by the renderer; Vitest's runtime
//  doesn't care about classes vs plain objects.
// ============================================================

interface PageEvent {
  event: string;
  handler: (...args: unknown[]) => void;
}

function createStubPage(opts: {
  html: string;
  finalUrl: string;
  status: number;
  headers?: Record<string, string>;
  responses?: { url: string; status: number; resourceType?: string }[];
  consoleMessages?: { type: 'error' | 'log'; text: string }[];
  pageErrors?: string[];
  failedRequests?: { url: string; errorText: string }[];
  gotoThrows?: Error;
  closeSpy?: () => void;
}) {
  const events: PageEvent[] = [];
  const fireEvents = () => {
    for (const r of opts.responses ?? []) {
      const respStub = {
        url: () => r.url,
        status: () => r.status,
        headers: () => ({}),
        // E4.5: requestX().resourceType() is read in the httpErrors
        // collection branch. Default 'other' mirrors Playwright's
        // fallback when the request has no specific type.
        request: () => ({ resourceType: () => r.resourceType ?? 'other' }),
      };
      events.filter(e => e.event === 'response').forEach(e => e.handler(respStub));
    }
    for (const e of opts.consoleMessages ?? []) {
      const msgStub = { type: () => e.type, text: () => e.text };
      events.filter(ev => ev.event === 'console').forEach(ev => ev.handler(msgStub));
    }
    for (const err of opts.pageErrors ?? []) {
      events.filter(e => e.event === 'pageerror').forEach(e => e.handler(new Error(err)));
    }
    for (const req of opts.failedRequests ?? []) {
      const reqStub = { url: () => req.url, failure: () => ({ errorText: req.errorText }) };
      events.filter(e => e.event === 'requestfailed').forEach(e => e.handler(reqStub));
    }
  };

  return {
    on: (event: string, handler: (...args: unknown[]) => void) => {
      events.push({ event, handler });
    },
    goto: vi.fn(async () => {
      if (opts.gotoThrows) throw opts.gotoThrows;
      fireEvents();
      return {
        status: () => opts.status,
        headers: () => opts.headers ?? { 'content-type': 'text/html' },
      };
    }),
    content: vi.fn(async () => opts.html),
    url: vi.fn(() => opts.finalUrl),
    close: vi.fn(async () => { opts.closeSpy?.(); }),
  };
}

function createStubBrowser(page: ReturnType<typeof createStubPage>, contextSpy?: { contextCreated: number; closed: number }) {
  return {
    newContext: vi.fn(async () => {
      if (contextSpy) contextSpy.contextCreated++;
      return {
        newPage: vi.fn(async () => page),
        close: vi.fn(async () => { if (contextSpy) contextSpy.closed++; }),
      };
    }),
    close: vi.fn(async () => {}),
  };
}

// ============================================================
//  Tests
// ============================================================

describe('JsRenderer', () => {
  it('exposes mode = "js"', () => {
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => createStubBrowser(createStubPage({ html: '', finalUrl: '', status: 200 })) as never,
    });
    expect(r.mode).toBe('js');
  });

  it('returns rendered HTML, finalUrl and status from the browser', async () => {
    // Stub fetch for the static fallback so the parallel call doesn't blow up.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>raw</html>', {
      status: 200, headers: { 'content-type': 'text/html' },
    }));

    const page = createStubPage({
      html: '<html><body>rendered content</body></html>',
      finalUrl: 'https://example.com/final',
      status: 200,
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://example.com/');
    expect(result.mode).toBe('js');
    expect(result.html).toContain('rendered content');
    expect(result.finalUrl).toBe('https://example.com/final');
    expect(result.status).toBe(200);
    await r.close();
  });

  it('passes Authorization + customHeaders into the BrowserContext extraHTTPHeaders', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({ html: '', finalUrl: 'https://x.com/', status: 200 });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't',
      userAgent: 'TestUA',
      authHeader: 'Basic abc',
      customHeaders: { 'X-Custom': 'foo' },
      connect: async () => browser as never,
    });

    await r.fetch('https://x.com/');
    const calls = browser.newContext.mock.calls as unknown as [{ userAgent: string; extraHTTPHeaders: Record<string, string> }][];
    const newContextCall = calls[0][0];
    expect(newContextCall.userAgent).toBe('TestUA');
    expect(newContextCall.extraHTTPHeaders.Authorization).toBe('Basic abc');
    expect(newContextCall.extraHTTPHeaders['X-Custom']).toBe('foo');
    await r.close();
  });

  it('captures console errors and page errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({
      html: '', finalUrl: 'https://x.com/', status: 200,
      consoleMessages: [
        { type: 'error', text: 'Uncaught TypeError: foo is null' },
        { type: 'log', text: 'should be ignored' },
      ],
      pageErrors: ['ReferenceError: bar is not defined'],
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://x.com/');
    expect(result.consoleErrors).toEqual(expect.arrayContaining([
      'Uncaught TypeError: foo is null',
      'ReferenceError: bar is not defined',
    ]));
    expect(result.consoleErrors).not.toContain('should be ignored');
    await r.close();
  });

  it('captures failed requests with their failure text', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({
      html: '', finalUrl: 'https://x.com/', status: 200,
      failedRequests: [{ url: 'https://x.com/missing.png', errorText: 'net::ERR_FAILED' }],
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://x.com/');
    expect(result.failedRequests).toEqual(['https://x.com/missing.png: net::ERR_FAILED']);
    await r.close();
  });

  it('attaches the static-fetched HTML and word count to the result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<html><body><p>alpha beta gamma delta epsilon</p></body></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    ));
    const page = createStubPage({
      html: '<html><body><p>alpha beta gamma delta epsilon zeta eta theta</p></body></html>',
      finalUrl: 'https://x.com/', status: 200,
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://x.com/');
    expect(result.staticHtml).toContain('alpha beta gamma delta epsilon');
    expect(result.staticHtml).not.toContain('zeta');
    expect(result.staticWordCount).toBe(5); // visible word count of static HTML
    await r.close();
  });

  it('reuses the BrowserContext across multiple fetches in one audit', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({ html: '', finalUrl: 'https://x.com/', status: 200 });
    const counts = { contextCreated: 0, closed: 0 };
    const browser = createStubBrowser(page, counts);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    await r.fetch('https://x.com/a');
    await r.fetch('https://x.com/b');
    await r.fetch('https://x.com/c');
    expect(counts.contextCreated).toBe(1);
    await r.close();
    expect(counts.closed).toBe(1);
  });

  it('builds redirect chain from intermediate 3xx responses observed during navigation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({
      html: '<html></html>',
      finalUrl: 'https://example.com/final',
      status: 200,
      responses: [
        { url: 'https://example.com/', status: 301 },
        { url: 'https://example.com/middle', status: 302 },
        { url: 'https://example.com/final', status: 200 },
      ],
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://example.com/');
    expect(result.redirectChain).toEqual([
      'https://example.com/',
      'https://example.com/middle',
    ]);
    await r.close();
  });

  it('collects 4xx/5xx sub-resource responses into httpErrors with url + status + resourceType', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({
      html: '<html></html>',
      finalUrl: 'https://example.com/',
      status: 200,
      responses: [
        // Main page response (excluded — already represented by RenderResult.status).
        { url: 'https://example.com/', status: 200, resourceType: 'document' },
        // 4xx CSS — should land in httpErrors.
        { url: 'https://example.com/missing.css', status: 404, resourceType: 'stylesheet' },
        // 5xx XHR — should land in httpErrors.
        { url: 'https://api.example.com/data', status: 503, resourceType: 'xhr' },
        // 200 image — excluded.
        { url: 'https://example.com/logo.png', status: 200, resourceType: 'image' },
        // 3xx — excluded (lives in redirectChain instead).
        { url: 'https://example.com/old-script.js', status: 301, resourceType: 'script' },
      ],
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://example.com/');
    expect(result.httpErrors).toEqual([
      { url: 'https://example.com/missing.css', status: 404, resourceType: 'stylesheet' },
      { url: 'https://api.example.com/data', status: 503, resourceType: 'xhr' },
    ]);
    await r.close();
  });

  it('returns httpErrors as an empty array when no 4xx/5xx responses occurred', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({
      html: '<html></html>',
      finalUrl: 'https://example.com/',
      status: 200,
      responses: [
        { url: 'https://example.com/', status: 200, resourceType: 'document' },
        { url: 'https://example.com/style.css', status: 200, resourceType: 'stylesheet' },
      ],
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://example.com/');
    expect(result.httpErrors).toEqual([]);
    await r.close();
  });

  it('does NOT include the main-page 4xx response in httpErrors (already in RenderResult.status)', async () => {
    // Edge: a page itself returns 404 (e.g. a /not-found URL). The
    // 404 is captured on RenderResult.status — we don't double-count
    // it in httpErrors, which is reserved for sub-resource errors.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const page = createStubPage({
      html: '<html></html>',
      finalUrl: 'https://example.com/missing-page',
      status: 404,
      responses: [
        { url: 'https://example.com/missing-page', status: 404, resourceType: 'document' },
      ],
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://example.com/missing-page');
    expect(result.status).toBe(404);
    expect(result.httpErrors).toEqual([]);
    await r.close();
  });

  it('rethrows when BOTH static and JS fail (static returned empty body)', async () => {
    // Static probe returns an empty body — no useful fallback. JS render
    // throws too. The renderer must propagate the error so the crawler
    // can record the URL in unreachable / renderFailed via its catch.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({
      html: '', finalUrl: 'https://x.com/', status: 200,
      gotoThrows: new Error('Timeout 30000ms exceeded'),
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    await expect(r.fetch('https://x.com/')).rejects.toThrow(/Timeout/);
    await r.close();
  });

  it('falls back to static when JS render throws but static returned usable HTML', async () => {
    // Static probe returns a real 200 with HTML. JS goto throws (typical
    // Webflow networkidle timeout). Renderer must NOT throw — it returns
    // the static result with jsRenderFailed set so the crawler records
    // the URL in renderFailed[] (not brokenLinks).
    const staticBody = '<!doctype html><html><head><title>OK</title></head><body><h1>hi</h1></body></html>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(staticBody, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    const page = createStubPage({
      html: '', finalUrl: 'https://x.com/', status: 200,
      gotoThrows: new Error('Timeout 30000ms exceeded'),
    });
    const browser = createStubBrowser(page);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.fetch('https://x.com/');
    expect(result.status).toBe(200);
    expect(result.html).toBe(staticBody);
    expect(result.jsRenderFailed).toEqual({ reason: 'Timeout 30000ms exceeded' });
    expect(result.mode).toBe('static');  // mode flips since JS data is missing
    await r.close();
  });

  it('passes the token in the WebSocket query string', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({ html: '', finalUrl: 'https://x.com/', status: 200 });
    const browser = createStubBrowser(page);
    const seenWs: string[] = [];
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 'super-secret',
      userAgent: 'UA',
      connect: async (ws) => { seenWs.push(ws); return browser as never; },
    });

    await r.fetch('https://x.com/');
    expect(seenWs[0]).toBe('ws://localhost:9223?token=super-secret');
    await r.close();
  });
});

describe('JsRenderer.runAxe option', () => {
  it('does not call axeRunner when runAxe is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({ html: '', finalUrl: 'https://x.com/', status: 200 });
    const browser = createStubBrowser(page);
    const axeRunner = vi.fn(async () => []);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
      axeRunner,
      // runAxe defaults to false
    });
    const result = await r.fetch('https://x.com/');
    expect(axeRunner).not.toHaveBeenCalled();
    expect(result.axeViolations).toBeUndefined();
    await r.close();
  });

  it('calls axeRunner and attaches violations when runAxe is true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({ html: '', finalUrl: 'https://x.com/', status: 200 });
    const browser = createStubBrowser(page);
    const axeRunner = vi.fn(async () => [
      { id: 'color-contrast', impact: 'serious' as const, description: 'd',
        help: 'h', helpUrl: 'u', tags: ['wcag2aa'], nodes: 3 },
    ]);
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
      axeRunner,
      runAxe: true,
    });
    const result = await r.fetch('https://x.com/');
    expect(axeRunner).toHaveBeenCalledTimes(1);
    expect(result.axeViolations).toHaveLength(1);
    expect(result.axeViolations![0].id).toBe('color-contrast');
    await r.close();
  });

  it('swallows axeRunner errors — sets axeViolations to undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const page = createStubPage({ html: '', finalUrl: 'https://x.com/', status: 200 });
    const browser = createStubBrowser(page);
    const axeRunner = vi.fn(async () => { throw new Error('axe injection failed'); });
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
      axeRunner,
      runAxe: true,
    });
    // Must not throw — fetch should complete with no axe data.
    const result = await r.fetch('https://x.com/');
    expect(result.axeViolations).toBeUndefined();
    expect(result.html).toBeDefined(); // rest of the result is intact
    await r.close();
  });
});

describe('JsRenderer.captureScreenshot', () => {
  function setupForScreenshot() {
    const setViewportSize = vi.fn(async () => {});
    const screenshot = vi.fn(async () => Buffer.from('FAKE_PNG_BYTES'));
    const goto = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    // waitForTimeout is the post-navigation paint-settle hook. Stub
    // returns immediately so tests don't actually sleep 2s each.
    const waitForTimeout = vi.fn(async () => {});
    const page = {
      on: vi.fn(),
      setViewportSize,
      goto,
      content: vi.fn(async () => ''),
      url: vi.fn(() => ''),
      screenshot,
      close,
      waitForTimeout,
    };
    const browser = {
      newContext: vi.fn(async () => ({
        newPage: vi.fn(async () => page),
        close: vi.fn(async () => {}),
      })),
      close: vi.fn(async () => {}),
    };
    return { page, browser, setViewportSize, screenshot, goto, close, waitForTimeout };
  }

  it('sets the viewport before navigation and returns a base64 PNG', async () => {
    const { browser, setViewportSize, goto, screenshot } = setupForScreenshot();
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.captureScreenshot('https://x.com/', { width: 375, height: 667 });

    expect(setViewportSize).toHaveBeenCalledWith({ width: 375, height: 667 });
    expect(goto).toHaveBeenCalledWith('https://x.com/', expect.objectContaining({ waitUntil: 'domcontentloaded' }));
    expect(screenshot).toHaveBeenCalledWith({ fullPage: false, type: 'png' });
    // base64 of "FAKE_PNG_BYTES"
    expect(result).toBe(Buffer.from('FAKE_PNG_BYTES').toString('base64'));
    await r.close();
  });

  it('falls through to screenshot when goto times out — partial-capture fallback', async () => {
    // Pre-fix this returned undefined. New behaviour: log a warning,
    // then proceed to waitForTimeout + screenshot. The page DOM is
    // whatever painted before goto rejected, which on heavy Webflow
    // pages is typically the above-the-fold content.
    const { browser, goto, screenshot, close } = setupForScreenshot();
    goto.mockRejectedValueOnce(new Error('Timeout 15000ms exceeded'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.captureScreenshot('https://x.com/', { width: 375, height: 667 });
    expect(result).toBe(Buffer.from('FAKE_PNG_BYTES').toString('base64'));
    expect(screenshot).toHaveBeenCalled();              // screenshot still attempted
    expect(close).toHaveBeenCalled();                   // page still closed
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[screenshot] goto timeout'));
    expect(warnSpy.mock.calls[0][0]).toContain('https://x.com/');
    await r.close();
  });

  it('logs and returns undefined when screenshot itself throws', async () => {
    const { browser, screenshot, close } = setupForScreenshot();
    screenshot.mockRejectedValueOnce(new Error('disconnected'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.captureScreenshot('https://x.com/', { width: 1920, height: 1080 });
    expect(result).toBeUndefined();
    expect(close).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[screenshot] failed'));
    expect(errorSpy.mock.calls[0][0]).toContain('1920x1080');
    expect(errorSpy.mock.calls[0][0]).toContain('disconnected');
    await r.close();
  });

  it('logs the URL + viewport + reason when newPage rejects (Browserless overload class)', async () => {
    // Simulate Browserless rejecting newPage (e.g. queue full or
    // session-killed). Reaches the OUTER catch — distinct error
    // message from the goto-timeout case.
    const screenshot = vi.fn(async () => Buffer.from(''));
    const browser = {
      newContext: vi.fn(async () => ({
        newPage: vi.fn(async () => { throw new Error('Browserless: queue full'); }),
        close: vi.fn(async () => {}),
      })),
      close: vi.fn(async () => {}),
    };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.captureScreenshot('https://x.com/', { width: 375, height: 667 });
    expect(result).toBeUndefined();
    expect(screenshot).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('queue full'));
    await r.close();
  });

  it('reuses the BrowserContext across screenshot + fetch calls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const { browser } = setupForScreenshot();
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    await r.captureScreenshot('https://x.com/', { width: 375, height: 667 });
    await r.captureScreenshot('https://x.com/', { width: 1920, height: 1080 });
    expect(browser.newContext).toHaveBeenCalledTimes(1);
    await r.close();
  });
});

describe('probeBrowserless', () => {
  it('returns ok when /pressure responds 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const r = await probeBrowserless('ws://localhost:9223', 't');
    expect(r).toEqual({ ok: true });
  });

  it('returns ok=false with the status code when pressure responds 4xx/5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));
    const r = await probeBrowserless('ws://localhost:9223', 't');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('503');
  });

  it('returns ok=false with the network error when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await probeBrowserless('ws://localhost:9223', 't');
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain('ECONNREFUSED');
  });

  it('rewrites ws:// to http:// for the pressure check', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await probeBrowserless('ws://localhost:9223', 'tok');
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toMatch(/^http:\/\/localhost:9223/);
    expect(url).toContain('/pressure?token=tok');
  });

  it('rewrites wss:// to https://', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await probeBrowserless('wss://browser.example.com', 'tok');
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/browser\.example\.com/);
  });
});
