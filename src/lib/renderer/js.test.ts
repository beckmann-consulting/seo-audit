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
  responses?: { url: string; status: number }[];
  consoleMessages?: { type: 'error' | 'log'; text: string }[];
  pageErrors?: string[];
  failedRequests?: { url: string; errorText: string }[];
  gotoThrows?: Error;
  closeSpy?: () => void;
}) {
  const events: PageEvent[] = [];
  const fireEvents = () => {
    for (const r of opts.responses ?? []) {
      const respStub = { url: () => r.url, status: () => r.status, headers: () => ({}) };
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

  it('rethrows when page.goto fails so the crawler can mark the URL broken', async () => {
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

describe('JsRenderer.captureScreenshot', () => {
  function setupForScreenshot() {
    const setViewportSize = vi.fn(async () => {});
    const screenshot = vi.fn(async () => Buffer.from('FAKE_PNG_BYTES'));
    const goto = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const page = {
      on: vi.fn(),
      setViewportSize,
      goto,
      content: vi.fn(async () => ''),
      url: vi.fn(() => ''),
      screenshot,
      close,
    };
    const browser = {
      newContext: vi.fn(async () => ({
        newPage: vi.fn(async () => page),
        close: vi.fn(async () => {}),
      })),
      close: vi.fn(async () => {}),
    };
    return { page, browser, setViewportSize, screenshot, goto, close };
  }

  it('sets the viewport before navigation and returns a base64 PNG', async () => {
    const { browser, setViewportSize, goto, screenshot } = setupForScreenshot();
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.captureScreenshot('https://x.com/', { width: 375, height: 667 });

    expect(setViewportSize).toHaveBeenCalledWith({ width: 375, height: 667 });
    expect(goto).toHaveBeenCalledWith('https://x.com/', expect.any(Object));
    expect(screenshot).toHaveBeenCalledWith({ fullPage: false, type: 'png' });
    // base64 of "FAKE_PNG_BYTES"
    expect(result).toBe(Buffer.from('FAKE_PNG_BYTES').toString('base64'));
    await r.close();
  });

  it('returns undefined when navigation throws — never propagates the error', async () => {
    const { browser, goto, close } = setupForScreenshot();
    goto.mockRejectedValueOnce(new Error('Timeout'));
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    const result = await r.captureScreenshot('https://x.com/', { width: 375, height: 667 });
    expect(result).toBeUndefined();
    expect(close).toHaveBeenCalled(); // page is still closed cleanly
    await r.close();
  });

  it('closes the page even when screenshot throws', async () => {
    const { browser, screenshot, close } = setupForScreenshot();
    screenshot.mockRejectedValueOnce(new Error('disconnected'));
    const r = new JsRenderer({
      endpoint: 'ws://localhost:9223', token: 't', userAgent: 'UA',
      connect: async () => browser as never,
    });

    await r.captureScreenshot('https://x.com/', { width: 1920, height: 1080 });
    expect(close).toHaveBeenCalled();
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
  it('returns ok when /health responds 2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    const r = await probeBrowserless('ws://localhost:9223', 't');
    expect(r).toEqual({ ok: true });
  });

  it('returns ok=false with the status code when health responds 4xx/5xx', async () => {
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

  it('rewrites ws:// to http:// for the health check', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await probeBrowserless('ws://localhost:9223', 'tok');
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toMatch(/^http:\/\/localhost:9223/);
    expect(url).toContain('/health?token=tok');
  });

  it('rewrites wss:// to https://', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    await probeBrowserless('wss://browser.example.com', 'tok');
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toMatch(/^https:\/\/browser\.example\.com/);
  });
});
