// Common shape returned by every Renderer implementation.
//
// `mode` lets downstream code (crawler, findings) tell whether the
// HTML was produced by a plain HTTP fetch (`static`) or by a real
// headless browser (`js`). When mode === 'js' the result also carries
// the static fetch result captured in parallel — the SPA / "JS
// required" finding compares the two.

import type { AxeViolation } from '@/types';

export interface RenderResult {
  url: string;            // the URL we asked for
  finalUrl: string;       // after redirects
  status: number;         // final HTTP status
  contentType?: string;   // raw Content-Type header
  headers: Record<string, string>; // lowercased header map
  html: string;           // primary HTML — what the audit pipeline reads
  redirectChain: string[]; // URLs visited before the final one
  loopDetected: boolean;
  loadTimeMs: number;
  protocol: string | null; // 'h2' if alt-svc/via hint at HTTP/2+, else null
  mode: 'static' | 'js';
  // JS-mode only:
  staticHtml?: string;       // raw HTML before JS executed (for the diff)
  staticWordCount?: number;  // word count of the static HTML
  consoleErrors?: string[];  // page.on('console') / page.on('pageerror')
  failedRequests?: string[]; // resources the browser couldn't load
  axeViolations?: AxeViolation[]; // populated when JsRenderer.runAxe is true
}

export interface Renderer {
  readonly mode: 'static' | 'js';
  fetch(url: string): Promise<RenderResult>;
  close(): Promise<void>;
}

// Options passed to every concrete Renderer constructor.
export interface RendererOptions {
  userAgent: string;
  authHeader?: string;
  customHeaders?: Record<string, string>;
}
