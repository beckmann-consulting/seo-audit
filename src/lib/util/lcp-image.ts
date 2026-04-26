// Inspect Lighthouse's LCP-element snippet to surface the most common
// image-LCP performance mistakes. Lighthouse hands back the literal
// outer-HTML of the node it picked — for image LCPs this is the
// <img> tag, for text LCPs it's a heading/paragraph wrapping the text.
//
// We only do useful image analysis when the LCP element actually IS
// an <img>; for everything else we report `isImage: false` and the
// caller skips image-specific hints.

export interface LcpImageHints {
  isImage: boolean;
  isLazy: boolean;                // loading="lazy" — fatal for an LCP image
  hasFetchPriorityHigh: boolean;  // fetchpriority="high" — recommended for hero
  hasDimensions: boolean;         // width AND height present — prevents CLS
  src?: string;
}

const IMG_TAG = /^<img\b/i;
const LAZY_LOADING = /\bloading\s*=\s*["']?lazy\b/i;
const FETCH_PRIORITY_HIGH = /\bfetchpriority\s*=\s*["']?high\b/i;
const WIDTH_ATTR = /\bwidth\s*=/i;
const HEIGHT_ATTR = /\bheight\s*=/i;
const SRC_ATTR = /\bsrc\s*=\s*["']([^"']+)["']/i;

export function analyzeLcpImage(snippet: string | undefined): LcpImageHints {
  const empty: LcpImageHints = {
    isImage: false,
    isLazy: false,
    hasFetchPriorityHigh: false,
    hasDimensions: false,
  };
  if (!snippet) return empty;
  const trimmed = snippet.trimStart();
  if (!IMG_TAG.test(trimmed)) return empty;

  const srcMatch = trimmed.match(SRC_ATTR);
  return {
    isImage: true,
    isLazy: LAZY_LOADING.test(trimmed),
    hasFetchPriorityHigh: FETCH_PRIORITY_HIGH.test(trimmed),
    hasDimensions: WIDTH_ATTR.test(trimmed) && HEIGHT_ATTR.test(trimmed),
    src: srcMatch ? srcMatch[1] : undefined,
  };
}

// Build a list of human-readable sub-hints based on an analysis result.
// Returned in (de, en) pairs so callers can append directly to bilingual
// finding text. Empty when nothing is wrong.
export function describeImageHints(hints: LcpImageHints): { de: string[]; en: string[] } {
  const de: string[] = [];
  const en: string[] = [];
  if (!hints.isImage) return { de, en };

  if (hints.isLazy) {
    de.push('Das LCP-Bild hat loading="lazy" — das ist die häufigste Ursache für langsames LCP. Hero-Bilder sollten eager laden.');
    en.push('The LCP image has loading="lazy" — this is the single most common cause of slow LCP. Hero images should load eagerly.');
  }
  if (!hints.hasFetchPriorityHigh) {
    de.push('Das LCP-Bild hat kein fetchpriority="high". Setzen — der Browser priorisiert es dann gegenüber anderen Bildern und CSS-Hintergründen.');
    en.push('The LCP image has no fetchpriority="high". Set it — the browser will then prioritise this image over other images and CSS backgrounds.');
  }
  if (!hints.hasDimensions) {
    de.push('width/height-Attribute fehlen am LCP-Bild. Setzen verhindert zusätzlich Cumulative Layout Shift (CLS) beim Laden.');
    en.push('width/height attributes are missing on the LCP image. Setting them additionally prevents Cumulative Layout Shift (CLS) on load.');
  }
  return { de, en };
}
