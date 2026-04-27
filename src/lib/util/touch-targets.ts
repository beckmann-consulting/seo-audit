// Heuristic touch-target sizing analysis.
//
// Mobile-friendly UIs need interactive elements at least ~48×48 CSS
// pixels (WCAG 2.5.5 Level AAA, Apple HIG, Google Material). Without
// a layout engine we can't measure actual rendered dimensions, so
// this heuristic only catches the obvious mistake: an interactive
// element with EXPLICIT inline-style or attribute dimensions under
// the threshold AND no significant text content (icon-only).
//
// Phase E (Playwright integration) will replace this with the precise
// boundingClientRect approach. Until then we under-count rather than
// over-flag — the goal is to surface the most common icon-only
// pattern without false positives that would erode trust in the
// finding.

import type { HTMLElement } from 'node-html-parser';

export const TOUCH_TARGET_THRESHOLD_PX = 48;

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea']);

const STYLE_PX_RE = /(?:^|;|\s)(width|height)\s*:\s*([\d.]+)\s*px/gi;

// Parse a px value from the element's inline `style` attribute.
function parseStyleDimensions(el: HTMLElement): { width?: number; height?: number } {
  const style = el.getAttribute('style');
  if (!style) return {};
  const out: { width?: number; height?: number } = {};
  // Loop through all width/height declarations (last one wins, like CSS).
  let m: RegExpExecArray | null;
  STYLE_PX_RE.lastIndex = 0;
  while ((m = STYLE_PX_RE.exec(style)) !== null) {
    const v = parseFloat(m[2]);
    if (!Number.isFinite(v)) continue;
    if (m[1].toLowerCase() === 'width') out.width = v;
    else out.height = v;
  }
  return out;
}

// Parse a numeric width/height HTML attribute (img, input image, …).
function parseAttrDimensions(el: HTMLElement): { width?: number; height?: number } {
  const w = el.getAttribute('width');
  const h = el.getAttribute('height');
  const out: { width?: number; height?: number } = {};
  if (w) {
    const n = parseFloat(w);
    if (Number.isFinite(n)) out.width = n;
  }
  if (h) {
    const n = parseFloat(h);
    if (Number.isFinite(n)) out.height = n;
  }
  return out;
}

// Combine inline-style and attribute dimensions; style wins when both
// are set (matches browser CSS-vs-attr precedence for these tags).
function combinedDimensions(el: HTMLElement): { width?: number; height?: number } {
  const attr = parseAttrDimensions(el);
  const style = parseStyleDimensions(el);
  return {
    width: style.width ?? attr.width,
    height: style.height ?? attr.height,
  };
}

// True when the element is icon-only-ish: trivial text content
// (≤ 4 chars after trim and whitespace collapse). 4 chars catches
// "OK", "→", emoji glyphs, single-letter labels, and the like.
function isIconOnly(el: HTMLElement): boolean {
  const text = el.text.replace(/\s+/g, ' ').trim();
  return text.length <= 4;
}

// Look at the first child img/svg to infer the visible size when the
// element itself has no dimensions but wraps an icon.
function childIconDimensions(el: HTMLElement): { width?: number; height?: number } {
  const img = el.querySelector('img, svg');
  if (!img) return {};
  return combinedDimensions(img);
}

export interface TouchTargetOptions {
  threshold?: number;
}

// Returns the count of interactive elements that look smaller than
// the threshold in BOTH dimensions and contain little/no visible text.
export function countSmallTouchTargets(root: HTMLElement, opts: TouchTargetOptions = {}): number {
  const threshold = opts.threshold ?? TOUCH_TARGET_THRESHOLD_PX;
  let count = 0;

  for (const el of root.querySelectorAll('a, button, input, select, textarea')) {
    const tag = el.tagName?.toLowerCase();
    if (!INTERACTIVE_TAGS.has(tag)) continue;

    // Skip <input type="hidden"> — not user-visible.
    if (tag === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden') continue;
    }

    let dims = combinedDimensions(el);
    if (dims.width === undefined || dims.height === undefined) {
      const fromIcon = childIconDimensions(el);
      dims = { width: dims.width ?? fromIcon.width, height: dims.height ?? fromIcon.height };
    }

    // We need BOTH dimensions to make a confident call — without one
    // axis we can't tell whether CSS padding makes the element larger
    // than it appears in markup.
    if (dims.width === undefined || dims.height === undefined) continue;
    if (dims.width >= threshold && dims.height >= threshold) continue;

    // Final guard: only count icon-only elements. A button labelled
    // "Submit form" will get padding from the user-agent stylesheet
    // even with width:24px, while an icon-only <a> is far more likely
    // to be a true tap-target problem.
    if (!isIconOnly(el)) continue;

    count++;
  }

  return count;
}
