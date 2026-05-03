// AutoRenderer — runs static first, escalates to JS for pages whose
// static HTML looks like a client-rendered shell (same CSR heuristic
// extractor.ts uses post-render).
//
// Trade-off: an escalated page does a duplicate static fetch. We do
// one here to drive the decision; JsRenderer.fetch internally runs
// its own static probe in parallel for the static-vs-rendered diff.
// Static is ~100-200ms vs the JS render's ~2-5s, so the redundancy
// is rounding-error and not worth a JsRenderer-API refactor.
//
// Constructor takes already-built Renderer instances (typed as the
// Renderer interface, not the concrete classes) so unit tests can
// drop in stubs without spinning up a Browserless connection.

import type { Renderer, RenderResult } from './types';
import { detectCsrFromHtml } from '../util/csr-detection';

export class AutoRenderer implements Renderer {
  readonly mode = 'auto' as const;

  constructor(
    private readonly staticRenderer: Renderer,
    private readonly jsRenderer: Renderer,
  ) {}

  async fetch(url: string): Promise<RenderResult> {
    const staticResult = await this.staticRenderer.fetch(url);

    // Don't escalate non-2xx — JS render won't fix a 404 or 500, and
    // most error pages are tiny enough to look like CSR shells. Skip
    // the false-positive escalation cost.
    if (staticResult.status >= 400) {
      return staticResult;
    }

    const csr = detectCsrFromHtml(staticResult.html);
    if (!csr.likelyClientRendered) {
      return staticResult;
    }

    return this.jsRenderer.fetch(url);
  }

  async close(): Promise<void> {
    // Close both. JsRenderer.close releases the Browserless context;
    // StaticRenderer.close is a no-op but called for symmetry.
    await Promise.all([
      this.staticRenderer.close(),
      this.jsRenderer.close(),
    ]);
  }

  // Delegate screenshots to the inner JS renderer. Auto-mode always
  // wraps a real JsRenderer at runtime; the constructor's `Renderer`-
  // interface typing for jsRenderer is purely for test-stub flexibility.
  // Feature-detect rather than tighten the type so the stubbed tests
  // for AutoRenderer.fetch keep working without each gaining a no-op
  // captureScreenshot method.
  async captureScreenshot(
    url: string,
    viewport: { width: number; height: number },
  ): Promise<string | undefined> {
    const inner = this.jsRenderer as Renderer & {
      captureScreenshot?: (u: string, v: { width: number; height: number }) => Promise<string | undefined>;
    };
    if (typeof inner.captureScreenshot !== 'function') return undefined;
    return inner.captureScreenshot(url, viewport);
  }
}
