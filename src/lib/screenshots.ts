// Capture mobile + desktop screenshots of the most important pages
// for the optional PDF screenshot section (E2). The sample mirrors
// the parity-check sampling — top-N pages by lowest click depth — so
// the homepage and the most-linked-to entry points are covered.
//
// Sequencing is deliberate: each page gets mobile then desktop, one
// after another. Browserless's MAX_CONCURRENT_SESSIONS=2 means we
// could parallelise, but the screenshot pass usually runs at the
// tail of an audit with most of the timeout budget already spent;
// staying sequential keeps wall-time predictable.

import type { JsRenderer } from './renderer';
import type { PageSEOData } from '@/types';

export const SCREENSHOT_VIEWPORTS = {
  mobile: { width: 375, height: 667 },   // iPhone SE / iPhone 8
  desktop: { width: 1920, height: 1080 },
};

const DEFAULT_SCREENSHOT_PAGES = 4;       // homepage + 3 deep links

export interface ScreenshotResult {
  url: string;
  mobileBase64?: string;
  desktopBase64?: string;
}

export async function captureScreenshotsForAudit(
  renderer: JsRenderer,
  pages: PageSEOData[],
  limit: number = DEFAULT_SCREENSHOT_PAGES,
): Promise<ScreenshotResult[]> {
  if (limit <= 0 || pages.length === 0) return [];

  // Stable sort by depth ascending (matches D3 / parity sampling).
  const sample = [...pages].sort((a, b) => a.depth - b.depth).slice(0, limit);

  const results: ScreenshotResult[] = [];
  for (const page of sample) {
    const [mobile, desktop] = await Promise.all([
      renderer.captureScreenshot(page.url, SCREENSHOT_VIEWPORTS.mobile),
      renderer.captureScreenshot(page.url, SCREENSHOT_VIEWPORTS.desktop),
    ]);
    // Only add the page to the result list if at least one viewport
    // succeeded — otherwise we'd ship empty rows in the PDF.
    if (mobile || desktop) {
      results.push({ url: page.url, mobileBase64: mobile, desktopBase64: desktop });
    }
  }
  return results;
}
