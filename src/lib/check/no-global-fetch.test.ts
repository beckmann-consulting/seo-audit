// websites-27 (Codex review of c5c021d): a page whose HTML makes the parser
// throw (about 10,000 nested elements) must not lead to any request outside
// the safe-fetch transport: the crawler's error classifier used to HEAD-probe
// the URL with the global fetch, following redirects anywhere.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { crawlSite } from '@/lib/crawler';
import { classifyWithoutNetwork, runCheck } from './run-check';
import { FakeNet, type FakeAnswer } from './fake-net';
import type { RenderResult, Renderer } from '@/lib/renderer/types';

const DEEP = `<!doctype html><html><head><title>Tief verschachtelt</title></head><body>${'<div>'.repeat(10_000)}x${'</div>'.repeat(10_000)}</body></html>`;

const deepRenderer: Renderer = {
  mode: 'static',
  async fetch(url: string): Promise<RenderResult> {
    return { url, finalUrl: url, status: 200, contentType: 'text/html', headers: {}, html: DEEP, redirectChain: [], loopDetected: false, loadTimeMs: 1, protocol: null, mode: 'static' };
  },
  async close() {},
};

afterEach(() => vi.unstubAllGlobals());

describe('deeply nested HTML', () => {
  it('makes the link parsing throw, and the default classifier would then call the global fetch', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    vi.stubGlobal('fetch', spy);
    await crawlSite('https://attacker.example/', 1, undefined, 'ua', [], [], undefined, undefined, deepRenderer);
    expect(spy).toHaveBeenCalled();
  });

  it('with classifyWithoutNetwork the crawler makes no global request', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const r = await crawlSite('https://attacker.example/', 1, undefined, 'ua', [], [], undefined, undefined, deepRenderer, undefined, classifyWithoutNetwork);
    expect(spy).not.toHaveBeenCalled();
    expect(r.stats.renderFailed.length + r.pages.length).toBeGreaterThan(0);
  });

  it('a full check of such a page makes no global request and nothing outside the public address', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', spy);
    const net = new FakeNet({ 'attacker.example': ['93.184.216.34'] }, (url): FakeAnswer =>
      url.pathname === '/' ? { status: 200, body: DEEP } : { status: 302, headers: { location: 'http://169.254.169.254/' } });
    const controller = new AbortController();
    const outcome = await runCheck('attacker.example', {
      signal: controller.signal, deadline: Date.now() + 5000, transport: net.transport(controller.signal),
    }).catch(err => ({ thrown: String(err) }));
    controller.abort();
    expect(spy).not.toHaveBeenCalled();
    expect(net.requested.every(x => x.endsWith('@93.184.216.34'))).toBe(true);
    expect(outcome).toBeDefined();
  });
});
