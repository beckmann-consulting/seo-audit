import { describe, it, expect, vi, afterEach } from 'vitest';
import { StaticRenderer } from './static';

afterEach(() => { vi.restoreAllMocks(); });

const htmlResponse = (body: string, init: ResponseInit = {}) =>
  async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  });

describe('StaticRenderer', () => {
  it('exposes mode = "static"', () => {
    expect(new StaticRenderer({ userAgent: 'UA' }).mode).toBe('static');
  });

  it('returns RenderResult with html, status, finalUrl on a plain 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(htmlResponse('<html><body>ok</body></html>'));
    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/');
    expect(r.status).toBe(200);
    expect(r.finalUrl).toBe('https://example.com/');
    expect(r.html).toContain('ok');
    expect(r.mode).toBe('static');
    expect(r.redirectChain).toEqual([]);
  });

  it('attaches User-Agent / Authorization / customHeaders to every request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(htmlResponse('x'));
    await new StaticRenderer({
      userAgent: 'TestUA/1.0',
      authHeader: 'Basic abc',
      customHeaders: { 'X-Custom': 'tag' },
    }).fetch('https://example.com/');
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toBe('TestUA/1.0');
    expect(headers['Authorization']).toBe('Basic abc');
    expect(headers['X-Custom']).toBe('tag');
  });

  it('records the full redirect chain on consecutive 3xx hops', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => new Response(null, { status: 301, headers: { location: 'https://example.com/step-2' } }))
      .mockImplementationOnce(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/final' } }))
      .mockImplementationOnce(htmlResponse('<html></html>'));

    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/');
    expect(r.redirectChain).toEqual([
      'https://example.com/',
      'https://example.com/step-2',
    ]);
    expect(r.finalUrl).toBe('https://example.com/final');
    expect(r.status).toBe(200);
  });

  it('detects redirect loops without crashing', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => new Response(null, { status: 301, headers: { location: 'https://example.com/b' } }))
      .mockImplementationOnce(async () => new Response(null, { status: 301, headers: { location: 'https://example.com/' } }));

    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/');
    expect(r.loopDetected).toBe(true);
  });

  it('returns status 0 on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ETIMEDOUT'));
    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/');
    expect(r.status).toBe(0);
    expect(r.html).toBe('');
  });

  it('captures content-type and lowercased headers', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(htmlResponse('ok', {
      headers: { 'content-type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex' },
    }));
    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/');
    expect(r.contentType).toContain('text/html');
    expect(r.headers['x-robots-tag']).toBe('noindex');
  });

  it('skips body read for non-HTML content types', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('binary', {
      status: 200, headers: { 'content-type': 'application/pdf' },
    }));
    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/file.pdf');
    expect(r.status).toBe(200);
    expect(r.html).toBe('');
  });

  it('detects HTTP/2 from alt-svc header', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(htmlResponse('x', {
      headers: { 'content-type': 'text/html', 'alt-svc': 'h2=":443"' },
    }));
    const r = await new StaticRenderer({ userAgent: 'UA' }).fetch('https://example.com/');
    expect(r.protocol).toBe('h2');
  });

  it('close() is a no-op (stateless)', async () => {
    await expect(new StaticRenderer({ userAgent: 'UA' }).close()).resolves.toBeUndefined();
  });
});
