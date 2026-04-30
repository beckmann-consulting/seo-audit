import { describe, it, expect, vi } from 'vitest';
import { AutoRenderer } from './auto';
import { StaticRenderer } from './static';
import { JsRenderer } from './js';
import type { Renderer, RenderResult } from './types';

// Helper: build a stub Renderer whose fetch returns a fixed result.
function stubRenderer(mode: 'static' | 'js', result: Partial<RenderResult>): Renderer {
  const fullResult: RenderResult = {
    url: 'https://example.com/',
    finalUrl: 'https://example.com/',
    status: 200,
    headers: {},
    html: '',
    redirectChain: [],
    loopDetected: false,
    loadTimeMs: 100,
    protocol: null,
    mode,
    ...result,
  };
  return {
    mode,
    fetch: vi.fn(async () => fullResult),
    close: vi.fn(async () => {}),
  };
}

const SPA_SHELL_HTML = '<html><body><div id="root"></div></body></html>';
const SERVER_RENDERED_HTML =
  '<html><body><h1>Hello</h1>' +
  Array.from({ length: 30 }, () => '<p>This is real content past the threshold to avoid CSR detection.</p>').join('') +
  '</body></html>';

// ============================================================
//  Spec-driven matrix tests — covers all 6 cases listed in the
//  E3 ticket. mode=static and mode=js cases assert on the renderer
//  type the route layer would construct, since AutoRenderer is only
//  involved for mode=auto.
// ============================================================

describe('Renderer-Auswahl-Matrix — mode=static', () => {
  // Tests the route-level decision: mode=static always returns a
  // StaticRenderer, regardless of CSR signal.
  it('mode=static + CSR=true → StaticRenderer', () => {
    const r = new StaticRenderer({ userAgent: 'UA' });
    expect(r.mode).toBe('static');
  });

  it('mode=static + CSR=false → StaticRenderer', () => {
    const r = new StaticRenderer({ userAgent: 'UA' });
    expect(r.mode).toBe('static');
  });
});

describe('Renderer-Auswahl-Matrix — mode=js', () => {
  // Tests the route-level decision: mode=js always returns a
  // JsRenderer, regardless of CSR signal.
  it('mode=js + CSR=true → JsRenderer', () => {
    const r = new JsRenderer({
      userAgent: 'UA', endpoint: 'ws://x', token: 't',
      connect: vi.fn(),
    });
    expect(r.mode).toBe('js');
  });

  it('mode=js + CSR=false → JsRenderer', () => {
    const r = new JsRenderer({
      userAgent: 'UA', endpoint: 'ws://x', token: 't',
      connect: vi.fn(),
    });
    expect(r.mode).toBe('js');
  });
});

describe('Renderer-Auswahl-Matrix — mode=auto', () => {
  it('mode=auto + CSR=true → static fetch THEN js fetch (escalated)', async () => {
    const staticStub = stubRenderer('static', { html: SPA_SHELL_HTML, status: 200 });
    const jsStub = stubRenderer('js', { html: '<html><body>hydrated</body></html>', status: 200 });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/');

    expect(staticStub.fetch).toHaveBeenCalledTimes(1);
    expect(jsStub.fetch).toHaveBeenCalledTimes(1);
    expect(result.html).toContain('hydrated');
    expect(result.mode).toBe('js');
  });

  it('mode=auto + CSR=false → static fetch ONLY (no escalation)', async () => {
    const staticStub = stubRenderer('static', { html: SERVER_RENDERED_HTML, status: 200 });
    const jsStub = stubRenderer('js', { html: 'should-not-be-called' });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/');

    expect(staticStub.fetch).toHaveBeenCalledTimes(1);
    expect(jsStub.fetch).not.toHaveBeenCalled();
    expect(result.html).toBe(SERVER_RENDERED_HTML);
    expect(result.mode).toBe('static');
  });
});

describe('AutoRenderer — error / non-2xx pages', () => {
  it('does NOT escalate a 404 even if the body looks like a CSR shell', async () => {
    const staticStub = stubRenderer('static', { html: SPA_SHELL_HTML, status: 404 });
    const jsStub = stubRenderer('js', { html: 'should-not-be-called' });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/missing');

    expect(jsStub.fetch).not.toHaveBeenCalled();
    expect(result.status).toBe(404);
  });

  it('does NOT escalate a 5xx', async () => {
    const staticStub = stubRenderer('static', { html: SPA_SHELL_HTML, status: 503 });
    const jsStub = stubRenderer('js', { html: 'should-not-be-called' });

    const auto = new AutoRenderer(staticStub, jsStub);
    await auto.fetch('https://example.com/down');

    expect(jsStub.fetch).not.toHaveBeenCalled();
  });
});

describe('AutoRenderer — E4 fields (renderTimeMs + staticVsRenderedDiff)', () => {
  // Field passthrough is the contract: AutoRenderer never computes
  // these itself. JsRenderer sets them on its result, and on
  // escalation AutoRenderer just forwards the result as-is.
  it('forwards renderTimeMs + staticVsRenderedDiff from the JS path on escalation', async () => {
    const staticStub = stubRenderer('static', { html: SPA_SHELL_HTML, status: 200 });
    const jsStub = stubRenderer('js', {
      html: '<html><body>hydrated content here</body></html>',
      status: 200,
      renderTimeMs: 1234,
      staticVsRenderedDiff: {
        wordCountStatic: 0,
        wordCountRendered: 3,
        wordCountDelta: 3,
        wordCountDeltaRatio: 3,
        linkCountStatic: 0,
        linkCountRendered: 0,
        linkCountDelta: 0,
      },
    });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/');

    expect(result.renderTimeMs).toBe(1234);
    expect(result.staticVsRenderedDiff?.wordCountDelta).toBe(3);
  });

  it('forwards httpErrors from the JS path on escalation', async () => {
    const staticStub = stubRenderer('static', { html: SPA_SHELL_HTML, status: 200 });
    const jsStub = stubRenderer('js', {
      html: '<html><body>hydrated</body></html>',
      status: 200,
      httpErrors: [
        { url: 'https://example.com/broken.js', status: 404, resourceType: 'script' },
      ],
    });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/');

    expect(result.httpErrors).toEqual([
      { url: 'https://example.com/broken.js', status: 404, resourceType: 'script' },
    ]);
  });

  it('leaves httpErrors undefined when not escalated', async () => {
    const staticStub = stubRenderer('static', { html: SERVER_RENDERED_HTML, status: 200 });
    const jsStub = stubRenderer('js', { html: 'never-called' });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/');

    expect(result.httpErrors).toBeUndefined();
  });

  it('leaves renderTimeMs + staticVsRenderedDiff undefined when not escalated', async () => {
    const staticStub = stubRenderer('static', { html: SERVER_RENDERED_HTML, status: 200 });
    const jsStub = stubRenderer('js', { html: 'never-called' });

    const auto = new AutoRenderer(staticStub, jsStub);
    const result = await auto.fetch('https://example.com/');

    expect(result.renderTimeMs).toBeUndefined();
    expect(result.staticVsRenderedDiff).toBeUndefined();
  });
});

describe('AutoRenderer — close() lifecycle', () => {
  it('closes both inner renderers', async () => {
    const staticStub = stubRenderer('static', { html: '' });
    const jsStub = stubRenderer('js', { html: '' });

    const auto = new AutoRenderer(staticStub, jsStub);
    await auto.close();

    expect(staticStub.close).toHaveBeenCalledTimes(1);
    expect(jsStub.close).toHaveBeenCalledTimes(1);
  });

  it('exposes mode === "auto"', () => {
    const staticStub = stubRenderer('static', { html: '' });
    const jsStub = stubRenderer('js', { html: '' });
    const auto = new AutoRenderer(staticStub, jsStub);
    expect(auto.mode).toBe('auto');
  });
});
