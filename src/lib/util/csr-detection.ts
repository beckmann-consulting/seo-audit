// Heuristic detection of client-side rendering — used in two places:
//
//   - extractor.ts (post-render), which already has a parsed root and
//     a wordCount, calls detectCsrFromRoot to populate
//     PageSEOData.likelyClientRendered without parsing twice.
//
//   - AutoRenderer (pre-render), which has only the bytes from a
//     static fetch and uses detectCsrFromHtml to decide whether to
//     escalate that page to JS rendering.
//
// Two signals trigger detection:
//   1. A common SPA root container (#root, #app, #__next, #___gatsby,
//      #__nuxt, [data-reactroot]) is present but its inner text is
//      under 100 characters — the framework's empty shell.
//   2. The body has fewer than 30 visible words AND a <noscript>
//      element with substantive content (>50 chars) — the static HTML
//      is a JS-required placeholder.

import type { HTMLElement } from 'node-html-parser';
import { parse } from 'node-html-parser';
import { countVisibleWords } from './visible-text';

const SPA_ROOTS: { selector: string; name: string }[] = [
  { selector: '#root', name: 'React #root' },
  { selector: '#app', name: 'Vue/generic #app' },
  { selector: '#__next', name: 'Next.js #__next' },
  { selector: '#___gatsby', name: 'Gatsby #___gatsby' },
  { selector: '#__nuxt', name: 'Nuxt #__nuxt' },
  { selector: '[data-reactroot]', name: 'React data-reactroot' },
];

const SPA_ROOT_TEXT_THRESHOLD = 100;
const LOW_WORD_COUNT_THRESHOLD = 30;
const NOSCRIPT_TEXT_THRESHOLD = 50;

export interface CsrDetection {
  likelyClientRendered: boolean;
  signal?: string;
}

// Inputs are values the caller already has — saves a duplicate parse
// + word-count when called from extractor.ts.
export function detectCsrFromRoot(root: HTMLElement, wordCount: number): CsrDetection {
  for (const { selector, name } of SPA_ROOTS) {
    const el = root.querySelector(selector);
    if (el) {
      const innerText = el.text.replace(/\s+/g, ' ').trim();
      if (innerText.length < SPA_ROOT_TEXT_THRESHOLD) {
        return {
          likelyClientRendered: true,
          signal: `${name} is empty (${innerText.length} chars)`,
        };
      }
    }
  }

  if (wordCount < LOW_WORD_COUNT_THRESHOLD) {
    const noscript = root.querySelector('noscript');
    if (noscript && noscript.text.trim().length > NOSCRIPT_TEXT_THRESHOLD) {
      return {
        likelyClientRendered: true,
        signal: `body has ${wordCount} words but <noscript> contains content`,
      };
    }
  }

  return { likelyClientRendered: false };
}

// Convenience entry point for AutoRenderer — parses + counts words
// from raw HTML bytes. Slightly more expensive than detectCsrFromRoot
// (parses the document) but fine for once-per-page use.
export function detectCsrFromHtml(html: string): CsrDetection {
  const root = parse(html);
  const wordCount = countVisibleWords(html);
  return detectCsrFromRoot(root, wordCount);
}
