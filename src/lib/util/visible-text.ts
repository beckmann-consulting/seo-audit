// Visible-text extraction utilities — shared between the parity probe,
// the JS renderer's static-vs-rendered diff, and the extractor's
// text-html-ratio computation.
//
// "Visible" here means "what a user would see if JS-rendered content
// were stripped" — concretely: body text minus script / style /
// noscript content. node-html-parser's body.text concatenates script
// content as text, so we have to walk the DOM ourselves.

import { parse } from 'node-html-parser';

interface DomNodeLike {
  nodeType: number;
  tagName?: string;
  rawText?: string;
  text?: string;
  childNodes?: unknown[];
}

// Walk a DOM node, accumulating text-node content while skipping any
// subtree under <script>, <style>, or <noscript>.
function collectText(node: DomNodeLike, out: { value: string }): void {
  if (!node) return;
  if (node.nodeType === 3) {
    out.value += node.rawText ?? node.text ?? '';
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName?.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
  for (const child of node.childNodes ?? []) {
    collectText(child as DomNodeLike, out);
  }
}

// Visible body text from a parsed HTML root, with whitespace
// collapsed and trimmed. Returns '' when no body element exists.
function visibleBodyText(html: string): string {
  const root = parse(html, { comment: false });
  const body = root.querySelector('body');
  if (!body) return '';
  const acc = { value: '' };
  collectText(body as unknown as DomNodeLike, acc);
  return acc.value.replace(/\s+/g, ' ').trim();
}

// Count "content words" the way extractor.ts does: split on space,
// keep only tokens longer than 2 characters. Keeps comparisons
// (parity, static-vs-rendered diff) apples-to-apples with
// PageSEOData.wordCount.
export function countVisibleWords(html: string): number {
  const text = visibleBodyText(html);
  if (!text) return 0;
  return text.split(' ').filter(w => w.length > 2).length;
}
