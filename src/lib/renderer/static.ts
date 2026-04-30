// StaticRenderer — wraps the original fetch-with-manual-redirect-tracking
// logic that used to live inline in crawler.ts. Behaviour is identical
// to before the Renderer refactor; the only change is that the crawler
// now goes through this interface so the JS-mode counterpart can plug
// in transparently.

import type { Renderer, RenderResult, RendererOptions } from './types';

const MAX_REDIRECT_HOPS = 10;
const FETCH_TIMEOUT_MS = 12_000;

function buildHeaders(opts: RendererOptions): HeadersInit {
  const h: Record<string, string> = {
    'User-Agent': opts.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en,de;q=0.9',
  };
  if (opts.authHeader) h['Authorization'] = opts.authHeader;
  if (opts.customHeaders) {
    for (const [name, value] of Object.entries(opts.customHeaders)) {
      h[name] = value;
    }
  }
  return h;
}

// Heuristic protocol detection — Node's fetch doesn't expose the wire
// protocol, so we read alt-svc / via headers as a proxy. Same logic
// the legacy crawler.ts used.
function detectProtocol(headers: Headers): string | null {
  const altSvc = headers.get('alt-svc') || '';
  const viaHeader = headers.get('via') || '';
  if (/\bh3\b|\bh2\b|hq=/i.test(altSvc)) return 'h2';
  if (/2\.0/.test(viaHeader)) return 'h2';
  return null;
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, name) => { out[name.toLowerCase()] = value; });
  return out;
}

export class StaticRenderer implements Renderer {
  readonly mode = 'static' as const;
  private readonly headers: HeadersInit;

  constructor(private readonly opts: RendererOptions) {
    this.headers = buildHeaders(opts);
  }

  async fetch(startUrl: string): Promise<RenderResult> {
    const start = Date.now();
    // [static-trace] DIAGNOSTIC — to be removed after the audit-hang
    // issue is resolved.
    console.log(`[static-trace] +0ms fetch-start url=${startUrl}`);
    const chain: string[] = [];
    let currentUrl = startUrl;
    let loopDetected = false;
    let lastResponse: Response | undefined;

    for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
      try {
        const resp = await fetch(currentUrl, {
          headers: this.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        lastResponse = resp;

        // 3xx → follow manually, recording the chain
        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) break;
          let nextUrl: string;
          try {
            nextUrl = new URL(location, currentUrl).href;
          } catch {
            break;
          }
          chain.push(currentUrl);
          if (chain.includes(nextUrl)) {
            loopDetected = true;
            currentUrl = nextUrl;
            break;
          }
          currentUrl = nextUrl;
          continue;
        }
        break;
      } catch (err) {
        // network error / timeout — return a synthetic 0-status result
        // so the crawler can record the URL as broken without crashing.
        console.log(`[static-trace] +${Date.now() - start}ms fetch-error message=${(err as Error).message}`);
        return {
          url: startUrl,
          finalUrl: currentUrl,
          status: 0,
          headers: {},
          html: '',
          redirectChain: chain,
          loopDetected,
          loadTimeMs: Date.now() - start,
          protocol: null,
          mode: 'static',
        };
      }
    }

    if (!lastResponse) {
      console.log(`[static-trace] +${Date.now() - start}ms fetch-done status=0 bytes=0 reason=no-response`);
      return {
        url: startUrl,
        finalUrl: currentUrl,
        status: 0,
        headers: {},
        html: '',
        redirectChain: chain,
        loopDetected,
        loadTimeMs: Date.now() - start,
        protocol: null,
        mode: 'static',
      };
    }

    // Read body only when content-type looks like HTML to keep memory
    // bounded; the crawler already filters non-HTML pages anyway.
    const contentType = lastResponse.headers.get('content-type') || undefined;
    let html = '';
    if (contentType && contentType.includes('text/html')) {
      try {
        html = await lastResponse.text();
      } catch {
        html = '';
      }
    }

    console.log(`[static-trace] +${Date.now() - start}ms fetch-done status=${lastResponse.status} bytes=${html.length}`);
    return {
      url: startUrl,
      finalUrl: currentUrl,
      status: lastResponse.status,
      contentType,
      headers: headersToObject(lastResponse.headers),
      html,
      redirectChain: chain,
      loopDetected,
      loadTimeMs: Date.now() - start,
      protocol: detectProtocol(lastResponse.headers),
      mode: 'static',
    };
  }

  async close(): Promise<void> {
    // Stateless — nothing to release.
  }
}
