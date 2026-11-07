// Pure signals over the HTML of one page, for the checks of the AI
// visibility module. No network, no state: HTML in, plain data out.

import { parse, type HTMLElement } from 'node-html-parser';
import { parseXRobotsTag } from '@/lib/util/x-robots';

// ------------------------------------------------------------
//  Text helpers
// ------------------------------------------------------------

interface NodeLike { nodeType: number; tagName?: string; rawText?: string; text?: string; childNodes?: unknown[] }

const SKIP_TEXT = new Set(['script', 'style', 'noscript', 'template', 'svg']);

/**
 * The declarations of an inline style, split at the semicolons outside strings, comments and
 * brackets. Comments go; escapes stay for unescapeCss.
 */
function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === '\\' && i + 1 < style.length) { cur += c + style[++i]; continue; }
      if (c === quote) quote = '';
      cur += c;
      continue;
    }
    if (c === '/' && style[i + 1] === '*') {
      const end = style.indexOf('*/', i + 2);
      i = end < 0 ? style.length : end + 1;
      cur += ' ';
      continue;
    }
    if (c === '\\' && i + 1 < style.length) { cur += c + style[++i]; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && depth > 0) depth--;
    else if (c === ';' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** The first colon of a declaration that is not escaped, or -1. */
function declarationColon(decl: string): number {
  for (let i = 0; i < decl.length; i++) {
    if (decl[i] === '\\') i++;
    else if (decl[i] === ':') return i;
  }
  return -1;
}

/** CSS escapes resolved: a hex code point (with one optional space after it) or the escaped character. */
function unescapeCss(s: string): string {
  return s.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([\s\S])/g, (_, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '\ufffd';
    }
    return ch ?? '';
  });
}

/**
 * The value each property of an inline style ends up with: declarations by their exact property
 * name, a later one overriding an earlier one unless the earlier one is !important and the later
 * one is not. Custom properties (--x) are properties of their own; a semicolon inside a string,
 * a comment or brackets does not end a declaration.
 */
export function inlineStyleValues(style: string): Map<string, string> {
  const out = new Map<string, { value: string; important: boolean }>();
  for (const decl of splitDeclarations(style)) {
    const colon = declarationColon(decl);
    if (colon < 0) continue;
    const prop = unescapeCss(decl.slice(0, colon).trim());
    const name = prop.startsWith('--') ? prop : prop.toLowerCase();
    let value = decl.slice(colon + 1).trim();
    if (!name || !value) continue;
    if (!name.startsWith('--')) value = unescapeCss(value).toLowerCase();
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    const prev = out.get(name);
    if (prev && prev.important && !important) continue;
    out.set(name, { value, important });
  }
  return new Map([...out].map(([k, v]) => [k, v.value]));
}

/**
 * Hidden by the markup itself (Prüfer-209): the hidden attribute, aria-hidden="true", or an inline
 * display:none / visibility:hidden or collapse. Text inside such an element is not visible.
 */
export function isHiddenElement(el: HTMLElement): boolean {
  if (!el || el.nodeType !== 1 || !el.getAttribute) return false;
  if (el.getAttribute('hidden') !== undefined && el.getAttribute('hidden') !== null) return true;
  if ((el.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return true;
  const style = inlineStyleValues(el.getAttribute('style') || '');
  return style.get('display') === 'none' || ['hidden', 'collapse'].includes(style.get('visibility') ?? '');
}

/** The element or one of its ancestors is hidden. */
export function inHidden(el: HTMLElement | null): boolean {
  for (let p: HTMLElement | null = el; p && p.nodeType === 1; p = p.parentNode as HTMLElement | null) {
    if (isHiddenElement(p)) return true;
  }
  return false;
}

function collect(node: NodeLike, out: string[], skip: Set<string>): void {
  if (!node) return;
  if (node.nodeType === 3) {
    out.push(node.rawText ?? node.text ?? '');
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName?.toLowerCase() ?? '';
  if (SKIP_TEXT.has(tag) || skip.has(tag)) return;
  if (isHiddenElement(node as unknown as HTMLElement)) return;
  for (const child of node.childNodes ?? []) collect(child as NodeLike, out, skip);
}

/**
 * Visible text of an element (no script, style, noscript, template, svg), whitespace collapsed;
 * empty when the element or one of its ancestors is hidden.
 */
export function visibleText(el: HTMLElement | null, skip: Set<string> = new Set()): string {
  if (!el || inHidden(el)) return '';
  const out: string[] = [];
  collect(el as unknown as NodeLike, out, skip);
  return decodeEntities(out.join(' ')).replace(/\s+/g, ' ').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Words the way extractor.ts counts them: tokens longer than 2 characters. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(' ').filter(w => w.length > 2).length;
}

// ------------------------------------------------------------
//  Main text, headings, head
// ------------------------------------------------------------

const BOILERPLATE = new Set(['nav', 'header', 'footer', 'aside']);

/**
 * The main content node: the first <main> that is not hidden, else the longest <article> that is not
 * hidden, else <body> without nav, header, footer, aside.
 */
function mainNode(root: HTMLElement): { el: HTMLElement | null; skip: Set<string> } {
  const main = root.querySelectorAll('main').find(m => !inHidden(m));
  if (main) return { el: main, skip: new Set() };
  const articles = root.querySelectorAll('article').filter(a => !inHidden(a));
  if (articles.length > 0) {
    return { el: articles.map(a => ({ a, n: visibleText(a).length })).sort((x, y) => y.n - x.n)[0].a, skip: new Set() };
  }
  return { el: root.querySelector('body'), skip: BOILERPLATE };
}

function mainText(root: HTMLElement): string {
  const { el, skip } = mainNode(root);
  return visibleText(el, skip);
}

export interface HeadSignals {
  title: string;
  canonical: string;
  hreflang: string[]; // "de=https://…" sorted, resolved against the page URL
  lang: string;
}

export interface ContentSignals {
  mainWords: number;
  headings: string[]; // H1 to H3, "h2: text", whitespace collapsed
  head: HeadSignals;
}

function resolve(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** Main-text words, H1 to H3 and the head (title, canonical, hreflang, lang) of a page. */
export function contentSignals(html: string, pageUrl: string): ContentSignals {
  const root = parse(html, { comment: false });
  const headings = root.querySelectorAll('h1, h2, h3')
    .map(h => `${h.tagName.toLowerCase()}: ${visibleText(h)}`)
    .filter(h => !h.endsWith(': '));
  const canonicalEl = root.querySelectorAll('link').find(l => (l.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  const hreflang = root.querySelectorAll('link')
    .filter(l => (l.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('alternate') && l.getAttribute('hreflang'))
    .map(l => `${(l.getAttribute('hreflang') || '').toLowerCase()}=${resolve(l.getAttribute('href') || '', pageUrl)}`)
    .sort();
  return {
    mainWords: countWords(mainText(root)),
    headings,
    head: {
      title: visibleText(root.querySelector('title')),
      canonical: canonicalEl ? resolve(canonicalEl.getAttribute('href') || '', pageUrl) : '',
      hreflang,
      lang: (root.querySelector('html')?.getAttribute('lang') || '').toLowerCase(),
    },
  };
}

// ------------------------------------------------------------
//  Snippet controls (check 2)
// ------------------------------------------------------------

export interface SnippetSignals {
  // nosnippet or max-snippet:0 for all bots or for Googlebot
  nosnippet: boolean;
  nosnippetSource: string[]; // where it came from, e.g. "meta robots", "X-Robots-Tag googlebot"
  // smallest positive max-snippet below the heuristic limit, if any
  maxSnippet?: number;
  // share of the main text inside data-nosnippet elements (div, span, section only)
  dataNosnippetShare: number;
}

const SNIPPET_BOTS = new Set(['robots', 'googlebot']);

function snippetDirectives(directives: string[]): { nosnippet: boolean; max?: number } {
  let nosnippet = false;
  let max: number | undefined;
  for (const d of directives) {
    const v = d.toLowerCase().trim();
    if (v === 'nosnippet') nosnippet = true;
    const m = v.match(/^max-snippet\s*:\s*(-?\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n === 0) nosnippet = true;
      else if (n > 0) max = max === undefined ? n : Math.min(max, n);
    }
  }
  return { nosnippet, max };
}

/** nosnippet, max-snippet and data-nosnippet from the HTML and the X-Robots-Tag header. */
export function snippetSignals(html: string, xRobotsTag?: string): SnippetSignals {
  const root = parse(html, { comment: false });
  const sources: string[] = [];
  let nosnippet = false;
  let maxSnippet: number | undefined;
  const take = (directives: string[], where: string) => {
    const r = snippetDirectives(directives);
    if (r.nosnippet) {
      nosnippet = true;
      sources.push(where);
    }
    if (r.max !== undefined) maxSnippet = maxSnippet === undefined ? r.max : Math.min(maxSnippet, r.max);
  };
  for (const meta of root.querySelectorAll('meta')) {
    const name = (meta.getAttribute('name') || '').toLowerCase().trim();
    if (!SNIPPET_BOTS.has(name)) continue;
    take((meta.getAttribute('content') || '').split(','), `meta ${name}`);
  }
  const header = parseXRobotsTag(xRobotsTag);
  if (header) {
    take(header.generalDirectives, 'X-Robots-Tag');
    for (const b of header.botSpecific) if (b.bot === 'googlebot') take(b.directives, 'X-Robots-Tag googlebot');
  }
  // data-nosnippet: Google supports it on div, span and section only. Counted and compared within the
  // same main content node (Codex, review of bcfe8de, F-007): a large footer or sidebar marked
  // data-nosnippet is not part of the main text.
  const { el: mainEl, skip } = mainNode(root);
  const total = countWords(visibleText(mainEl, skip));
  // a marked ancestor (or the main node itself marked) covers the whole main text (Prüfer-209)
  for (let p: HTMLElement | null = mainEl; p && p.nodeType === 1; p = p.parentNode as HTMLElement | null) {
    if (p.getAttribute && p.getAttribute('data-nosnippet') !== undefined && p.getAttribute('data-nosnippet') !== null && ['div', 'span', 'section'].includes(p.tagName?.toLowerCase())) {
      return { nosnippet, nosnippetSource: sources, maxSnippet, dataNosnippetShare: total > 0 ? 1 : 0 };
    }
  }
  let inside = 0;
  for (const el of mainEl ? mainEl.querySelectorAll('div[data-nosnippet], span[data-nosnippet], section[data-nosnippet]') : []) {
    // nested data-nosnippet elements count once; elements under a skipped boilerplate element do not count
    let p = el.parentNode as HTMLElement | null;
    let nested = false;
    while (p && p.nodeType === 1 && p !== mainEl) {
      const tag = p.tagName?.toLowerCase();
      if (skip.has(tag) || (p.getAttribute && p.getAttribute('data-nosnippet') !== undefined && ['div', 'span', 'section'].includes(tag))) {
        nested = true;
        break;
      }
      p = p.parentNode as HTMLElement | null;
    }
    if (!nested) inside += countWords(visibleText(el));
  }
  return { nosnippet, nosnippetSource: sources, maxSnippet, dataNosnippetShare: total > 0 ? Math.min(1, inside / total) : 0 };
}

// ------------------------------------------------------------
//  Answer friendliness (check 6, heuristics)
// ------------------------------------------------------------

const QUESTION_WORDS = [
  // de
  'was', 'wie', 'warum', 'wieso', 'weshalb', 'wann', 'wo', 'woher', 'wohin', 'wer', 'wen', 'wem', 'welche', 'welcher', 'welches',
  'wozu', 'womit', 'wofür', 'wieviel', 'kann', 'können', 'muss', 'müssen', 'soll', 'sollte', 'ist', 'sind', 'gibt', 'lohnt', 'braucht', 'brauche',
  // en
  'what', 'how', 'why', 'when', 'where', 'who', 'whom', 'which', 'can', 'could', 'should', 'does', 'do', 'is', 'are', 'will', 'would',
];

export function isQuestionHeading(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (t.endsWith('?')) return true;
  const first = t.split(/[\s,:]+/)[0];
  return QUESTION_WORDS.includes(first);
}

export interface AnswerSignals {
  questionHeadings: number;
  questionHeadingsWithAnswer: number;
  lists: number; // ul/ol with at least 3 items
  tables: number; // tables with th
  faqSection: boolean;
}

const FAQ_HEADING = /\b(faq|häufige fragen|haeufige fragen|fragen und antworten|frequently asked questions|questions and answers)\b/i;

/** Question headings with a direct answer paragraph, lists, tables, FAQ section. */
export function answerSignals(html: string): AnswerSignals {
  const root = parse(html, { comment: false });
  let questionHeadings = 0;
  let withAnswer = 0;
  for (const h of root.querySelectorAll('h2, h3')) {
    if (!isQuestionHeading(visibleText(h))) continue;
    questionHeadings++;
    const next = h.nextElementSibling;
    if (next && next.tagName?.toLowerCase() === 'p') {
      const words = visibleText(next).split(' ').filter(Boolean).length;
      if (words >= 15 && words <= 80) withAnswer++;
    }
  }
  // only what is visible counts: the structure and the parts that qualify it (Prüfer-210)
  const shown = (el: HTMLElement) => !inHidden(el);
  const lists = root.querySelectorAll('ul, ol').filter(l => shown(l) && l.querySelectorAll('li').filter(shown).length >= 3).length;
  const tables = root.querySelectorAll('table').filter(t => shown(t) && t.querySelectorAll('th').some(shown)).length;
  const faqHeading = root.querySelectorAll('h1, h2, h3, h4').some(h => FAQ_HEADING.test(visibleText(h)));
  const details = root.querySelectorAll('details').filter(d => shown(d) && d.querySelectorAll('summary').some(shown)).length;
  return { questionHeadings, questionHeadingsWithAnswer: withAnswer, lists, tables, faqSection: faqHeading || details >= 2 };
}

// ------------------------------------------------------------
//  Trust and freshness (check 7)
// ------------------------------------------------------------

export interface TrustSignals {
  visibleAuthor: boolean;
  visibleDate: boolean;
  contactLink: boolean;
  impressumLink: boolean;
}

const BYLINE = /(^|[\s(|·•])(von|by|autor(?:in)?|author|geschrieben von|written by)\s*:?\s+[A-ZÄÖÜ][\p{L}'’.-]+(\s+[A-ZÄÖÜ][\p{L}'’.-]+)?/u;
const DATE_TEXT = [
  /\b\d{1,2}\.\s?\d{1,2}\.\s?(19|20)\d{2}\b/, // 6.11.2026
  /\b(19|20)\d{2}-\d{2}-\d{2}\b/, // 2026-11-06
  /\b\d{1,2}\.\s?(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s+(19|20)\d{2}\b/i,
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(19|20)\d{2}\b/i,
  /\b\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(19|20)\d{2}\b/i,
];

/** Visible author and date (text, not meta or JSON-LD), links to contact and Impressum. */
export function trustSignals(html: string): TrustSignals {
  const root = parse(html, { comment: false });
  const body = root.querySelector('body');
  const text = visibleText(body);
  // a byline near the start of the main content (first 120 words), or a visible rel=author / author element
  const mainEl = mainNode(root).el || body;
  const head = visibleText(mainEl).split(' ').slice(0, 120).join(' ');
  const authorEl = root.querySelectorAll('[rel~="author"], [itemprop="author"], .author, .byline, [class*="author"]')
    .some(el => visibleText(el).length > 1);
  const visibleAuthor = BYLINE.test(head) || authorEl;
  const timeWithText = root.querySelectorAll('time').some(t => visibleText(t).length > 0);
  const visibleDate = timeWithText || DATE_TEXT.some(re => re.test(text));
  // a hidden link does not count; a visible one counts by its href even without text (an icon or image link)
  const links = root.querySelectorAll('a[href]').filter(a => !inHidden(a));
  const contactLink = links.some(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const label = visibleText(a).toLowerCase();
    return href.startsWith('mailto:') || href.startsWith('tel:') || /\/(kontakt|contact)(\/|$|[?#.])/.test(href) || /^(kontakt|contact)\b/.test(label);
  });
  const impressumLink = links.some(a => {
    const href = (a.getAttribute('href') || '').toLowerCase();
    const label = visibleText(a).toLowerCase();
    return /impressum|imprint|legal-notice|legal_notice/.test(href) || /\b(impressum|imprint|legal notice)\b/.test(label);
  });
  return { visibleAuthor, visibleDate, contactLink, impressumLink };
}
