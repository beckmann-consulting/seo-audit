// Approximate per-character pixel width when rendered in Google's
// SERP — Arial-equivalent at the size Google uses for desktop title
// rendering (~20px). Character-count alone is a poor proxy for
// SERP truncation: an 'i' takes ~4px, a 'W' takes ~19px, so a
// "60-character" title can be anywhere from ~280px to ~1100px.
//
// Numbers below come from the publicly documented Arial advance-
// width table at 20px regular weight (rounded to one decimal).
// Tolerance: real-world rendering varies by ±2-3% anyway, so we
// don't try to model kerning or sub-pixel rounding.

const ASCII_WIDTHS: Record<string, number> = {
  ' ': 5.6, '!': 5.6, '"': 7.1, '#': 11.1, '$': 11.1, '%': 17.8,
  '&': 13.3, "'": 3.8, '(': 6.7, ')': 6.7, '*': 7.8, '+': 11.7,
  ',': 5.6, '-': 6.7, '.': 5.6, '/': 5.6,
  '0': 11.1, '1': 11.1, '2': 11.1, '3': 11.1, '4': 11.1,
  '5': 11.1, '6': 11.1, '7': 11.1, '8': 11.1, '9': 11.1,
  ':': 5.6, ';': 5.6, '<': 11.7, '=': 11.7, '>': 11.7, '?': 11.1,
  '@': 20.3,
  'A': 13.3, 'B': 13.3, 'C': 14.4, 'D': 14.4, 'E': 13.3, 'F': 12.2,
  'G': 15.6, 'H': 14.4, 'I': 5.6, 'J': 10.0, 'K': 13.3, 'L': 11.1,
  'M': 16.7, 'N': 14.4, 'O': 15.6, 'P': 13.3, 'Q': 15.6, 'R': 14.4,
  'S': 13.3, 'T': 12.2, 'U': 14.4, 'V': 13.3, 'W': 18.9, 'X': 13.3,
  'Y': 13.3, 'Z': 12.2,
  '[': 5.6, '\\': 5.6, ']': 5.6, '^': 9.4, '_': 11.1, '`': 6.7,
  'a': 11.1, 'b': 11.1, 'c': 10.0, 'd': 11.1, 'e': 11.1, 'f': 5.6,
  'g': 11.1, 'h': 11.1, 'i': 4.4, 'j': 4.4, 'k': 10.0, 'l': 4.4,
  'm': 16.7, 'n': 11.1, 'o': 11.1, 'p': 11.1, 'q': 11.1, 'r': 6.7,
  's': 10.0, 't': 5.6, 'u': 11.1, 'v': 10.0, 'w': 14.4, 'x': 10.0,
  'y': 10.0, 'z': 10.0,
  '{': 6.7, '|': 5.2, '}': 6.7, '~': 11.7,
};

const FALLBACK_LATIN_PX = 11.0; // typical Latin-with-diacritics glyph
const FALLBACK_CJK_PX = 20.0;   // full-width
const TAB_PX = ASCII_WIDTHS[' ']; // treat tab as a single space

// Code-point ranges that render as full-width in Arial-Unicode-style fonts.
// Conservative — we only bucket the obvious CJK scripts; everything else
// gets the Latin fallback. This is good enough for SERP-truncation prediction
// because Google itself doesn't render exotic scripts at the same widths anyway.
function isCjkLike(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x9FFF) ||  // CJK Symbols + Unified Ideographs
    (codePoint >= 0xAC00 && codePoint <= 0xD7AF) ||  // Hangul Syllables
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||  // CJK Compatibility Ideographs
    (codePoint >= 0xFF00 && codePoint <= 0xFFEF)     // Halfwidth + Fullwidth Forms
  );
}

export function measurePixelWidth(text: string): number {
  if (!text) return 0;
  let total = 0;
  // Iterate by code point to handle surrogate pairs correctly.
  for (const ch of text) {
    if (ch === '\t') {
      total += TAB_PX;
      continue;
    }
    if (ch === '\n' || ch === '\r') continue;
    const ascii = ASCII_WIDTHS[ch];
    if (ascii !== undefined) {
      total += ascii;
      continue;
    }
    const cp = ch.codePointAt(0)!;
    total += isCjkLike(cp) ? FALLBACK_CJK_PX : FALLBACK_LATIN_PX;
  }
  return Math.round(total);
}

// SERP rendering thresholds. Google clips at slightly different widths for
// mobile vs. desktop; we use the stricter mobile threshold for "too long"
// because mobile-first indexing makes mobile the de-facto default.
export const TITLE_LIMIT_MOBILE_PX = 580;
export const TITLE_LIMIT_DESKTOP_PX = 600;
export const META_DESC_LIMIT_PX = 990;
