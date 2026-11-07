import { describe, it, expect } from 'vitest';
import { contentSignals, snippetSignals, answerSignals, trustSignals, isQuestionHeading, isHiddenElement, inlineStyleValues } from './signals';
import { parse, type HTMLElement } from 'node-html-parser';

const doc = (head: string, body: string) => `<!doctype html><html lang="de"><head>${head}</head><body>${body}</body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `wort${i}`).join(' ');

describe('contentSignals', () => {
  it('counts main-text words without nav/footer and lists H1 to H3 and the head', () => {
    const html = doc(
      '<title>Seite</title><link rel="canonical" href="/de/"><link rel="alternate" hreflang="en" href="/en/">',
      `<nav>${words(50)}</nav><h1>Titel</h1><h2>Teil</h2><p>${words(30)}</p><footer>${words(40)}</footer>`,
    );
    const s = contentSignals(html, 'https://example.com/de/');
    expect(s.mainWords).toBe(32); // 30 words plus the two headings' words longer than 2 characters
    expect(s.headings).toEqual(['h1: Titel', 'h2: Teil']);
    expect(s.head).toEqual({ title: 'Seite', canonical: 'https://example.com/de/', hreflang: ['en=https://example.com/en/'], lang: 'de' });
  });
  it('prefers <main> when there is one', () => {
    const s = contentSignals(doc('', `<header>${words(10)}</header><main><p>${words(5)}</p></main>`), 'https://example.com/');
    expect(s.mainWords).toBe(5);
  });
});

describe('snippetSignals (check 2)', () => {
  it('nothing restricting', () => {
    expect(snippetSignals(doc('<meta name="robots" content="index, follow, max-snippet:-1">', '<p>text</p>'))).toMatchObject({ nosnippet: false, maxSnippet: undefined, dataNosnippetShare: 0 });
  });
  it('nosnippet via meta robots and via X-Robots-Tag, general and for googlebot', () => {
    expect(snippetSignals(doc('<meta name="robots" content="nosnippet">', '')).nosnippet).toBe(true);
    expect(snippetSignals(doc('', ''), 'nosnippet').nosnippet).toBe(true);
    const g = snippetSignals(doc('', ''), 'googlebot: nosnippet');
    expect(g.nosnippet).toBe(true);
    expect(g.nosnippetSource).toEqual(['X-Robots-Tag googlebot']);
    expect(snippetSignals(doc('', ''), 'bingbot: nosnippet').nosnippet).toBe(false);
  });
  it('max-snippet:0 counts as nosnippet; a small positive value is reported', () => {
    expect(snippetSignals(doc('<meta name="googlebot" content="max-snippet:0">', '')).nosnippet).toBe(true);
    expect(snippetSignals(doc('<meta name="robots" content="max-snippet:20">', '')).maxSnippet).toBe(20);
  });
  it('data-nosnippet in a footer or sidebar outside the main content does not count (Codex, review of bcfe8de, F-007)', () => {
    const big = doc('', `<main><p>${words(40)}</p></main><footer><div data-nosnippet>${words(300)}</div></footer>`);
    expect(snippetSignals(big).dataNosnippetShare).toBe(0);
    const noMain = doc('', `<p>${words(40)}</p><aside><div data-nosnippet>${words(300)}</div></aside>`);
    expect(snippetSignals(noMain).dataNosnippetShare).toBe(0);
  });
  it('a data-nosnippet ancestor of the main content covers all of it (Prüfer-209)', () => {
    expect(snippetSignals(doc('', `<div data-nosnippet><main><p>${words(40)}</p></main></div>`)).dataNosnippetShare).toBe(1);
    expect(snippetSignals(doc('', `<main data-nosnippet><p>${words(40)}</p></main>`)).dataNosnippetShare).toBe(0); // main is no div, span or section
  });
  it('data-nosnippet counts on div, span and section only, and nested ones once', () => {
    const html = doc('', `<main><div data-nosnippet>${words(60)}<span data-nosnippet>${words(10)}</span></div><p data-nosnippet>${words(30)}</p></main>`);
    const s = snippetSignals(html);
    expect(s.dataNosnippetShare).toBeCloseTo(70 / 100, 5);
  });
});

describe('answerSignals (check 6)', () => {
  it('question headings, a direct answer paragraph, lists, tables, FAQ', () => {
    const html = doc('', `<h2>Was kostet ein Audit?</h2><p>${words(20)}</p><h2>Wie lange dauert es</h2><div>x</div>
      <ul><li>a</li><li>b</li><li>c</li></ul><table><tr><th>A</th></tr></table><h2>Häufige Fragen</h2>`);
    expect(answerSignals(html)).toEqual({ questionHeadings: 2, questionHeadingsWithAnswer: 1, lists: 1, tables: 1, faqSection: true });
  });
  it('hidden lists, tables, details and their hidden parts do not count (Prüfer-210)', () => {
    const hidden = doc('', `<main><p>${words(30)}</p><section hidden><ul><li>a</li><li>b</li><li>c</li></ul>
      <table><tr><th>A</th></tr></table><details><summary>F1</summary>A1</details><details><summary>F2</summary>A2</details></section></main>`);
    expect(answerSignals(hidden)).toMatchObject({ lists: 0, tables: 0, faqSection: false });
    const parts = doc('', `<main><ul><li>a</li><li hidden>b</li><li style="display:none">c</li></ul>
      <table><tr><th aria-hidden="true">A</th><td>1</td></tr></table>
      <details><summary hidden>F1</summary>A1</details><details style="visibility:hidden"><summary>F2</summary>A2</details></main>`);
    expect(answerSignals(parts)).toMatchObject({ lists: 0, tables: 0, faqSection: false });
    const shown = doc('', `<main><ul><li>a</li><li>b</li><li>c</li></ul><table><tr><th>A</th></tr></table>
      <details><summary>F1</summary>A1</details><details><summary>F2</summary>A2</details></main>`);
    expect(answerSignals(shown)).toMatchObject({ lists: 1, tables: 1, faqSection: true });
  });
  it('question words in German and English', () => {
    expect(isQuestionHeading('Warum KI-Sichtbarkeit')).toBe(true);
    expect(isQuestionHeading('How it works')).toBe(true);
    expect(isQuestionHeading('Leistungen')).toBe(false);
  });
});

describe('trustSignals (check 7)', () => {
  it('a visible byline and date, contact and Impressum links', () => {
    const html = doc('', `<main><p>von Tobias Beckmann, 6. November 2026</p><p>${words(20)}</p></main><footer><a href="/kontakt">Kontakt</a><a href="/impressum">Impressum</a></footer>`);
    expect(trustSignals(html)).toEqual({ visibleAuthor: true, visibleDate: true, contactLink: true, impressumLink: true });
  });
  it('author and date inside a hidden element are not visible (Prüfer-209)', () => {
    for (const wrap of ['<div hidden>', '<div aria-hidden="true">', '<div style="display: none">']) {
      const html = doc('', `<main>${wrap}<p>von Tobias Beckmann</p><span class="author">Tobias</span><time datetime="2026-11-06">6. November 2026</time></div><p>${words(20)}</p></main>`);
      expect(trustSignals(html), wrap).toMatchObject({ visibleAuthor: false, visibleDate: false });
    }
  });
  it('a hidden ancestor of <main> hides main text, headings, author and date (Codex, review of ef61356)', () => {
    const html = doc('', `<div hidden><main><h1>Versteckt</h1><p>von Tobias Beckmann, 6. November 2026</p><p>${words(8)}</p></main></div>`);
    expect(trustSignals(html)).toMatchObject({ visibleAuthor: false, visibleDate: false });
    const c = contentSignals(html, 'https://example.com/');
    expect(c.headings).toEqual([]);
    expect(c.mainWords).toBe(0);
    // a hidden <main> is passed over for the visible one
    const two = doc('', `<main hidden><p>${words(50)}</p></main><main><h1>Sichtbar</h1><p>von Tobias Beckmann</p><p>${words(5)}</p></main>`);
    expect(contentSignals(two, 'https://example.com/').mainWords).toBe(9);
    expect(trustSignals(two).visibleAuthor).toBe(true);
  });
  it('hidden contact and Impressum links do not count, visible icon links do (Codex, review of 9984836)', () => {
    const hidden = doc('', `<main><p>${words(20)}</p></main><footer hidden><a href="/kontakt"><img src="k.svg" alt=""></a><a href="/impressum"><img src="i.svg" alt=""></a></footer>`);
    expect(trustSignals(hidden)).toMatchObject({ contactLink: false, impressumLink: false });
    const inline = doc('', `<main><p>${words(20)}</p></main><footer><div style="display:none"><a href="mailto:a@example.com">Mail</a><a href="/imprint">Imprint</a></div></footer>`);
    expect(trustSignals(inline)).toMatchObject({ contactLink: false, impressumLink: false });
    const icons = doc('', `<main><p>${words(20)}</p></main><footer><a href="/kontakt"><img src="k.svg" alt=""></a><a href="/impressum"><img src="i.svg" alt=""></a></footer>`);
    expect(trustSignals(icons)).toMatchObject({ contactLink: true, impressumLink: true });
  });
  it('author and date only in meta or JSON-LD are not visible', () => {
    const html = doc('<meta name="author" content="Tobias"><script type="application/ld+json">{"@type":"Article","author":{"name":"Tobias"},"datePublished":"2026-11-06"}</script>', `<main><p>${words(20)}</p></main>`);
    expect(trustSignals(html)).toMatchObject({ visibleAuthor: false, visibleDate: false });
  });
});

describe('isHiddenElement (inline style by exact property)', () => {
  const el = (style: string) => parse(`<div style="${style}">x</div>`).querySelector('div') as HTMLElement;
  it('a custom property or a later override does not hide (Codex, review of ef61356)', () => {
    expect(isHiddenElement(el('--display: none'))).toBe(false);
    expect(isHiddenElement(el('--visibility:hidden'))).toBe(false);
    expect(isHiddenElement(el('display:none; display: block'))).toBe(false);
    expect(isHiddenElement(el('visibility: hidden; visibility: visible'))).toBe(false);
    expect(isHiddenElement(el('/* display:none */ color: red'))).toBe(false);
    const html = doc('', `<main><div style="--display: none"><p>von Tobias Beckmann</p><p>${words(6)}</p></div></main>`);
    expect(trustSignals(html).visibleAuthor).toBe(true);
    expect(contentSignals(html, 'https://example.com/').mainWords).toBe(9);
  });
  it('a semicolon inside a string, a comment or brackets does not end a declaration (Codex, review of 9984836)', () => {
    expect(isHiddenElement(el(`--label: 'x; display: none; y'`))).toBe(false);
    expect(isHiddenElement(el(`content: 'a\\'; display: none; b'`))).toBe(false);
    expect(isHiddenElement(el('/* ; display: none; */ color: red'))).toBe(false);
    expect(isHiddenElement(el('background: url(x;display:none)'))).toBe(false);
    expect(isHiddenElement(el(`--label: 'x; y'; display: none`))).toBe(true);
    expect(isHiddenElement(el('disp\\lay: n\\6f ne'))).toBe(true); // CSS escapes in name and value
    const html = `<!doctype html><html lang="de"><head></head><body><main><div style='--label: "x; display: none; y"'><p>von Tobias Beckmann</p><p>${words(6)}</p></div></main></body></html>`;
    expect(contentSignals(html, 'https://example.com/').mainWords).toBe(9);
    expect(trustSignals(html).visibleAuthor).toBe(true);
  });
  it('the last declaration wins, !important beats a later plain one', () => {
    expect(isHiddenElement(el('display: block; DISPLAY : None'))).toBe(true);
    expect(isHiddenElement(el('display: none !important; display: block'))).toBe(true);
    expect(isHiddenElement(el('display: none; display: block !important'))).toBe(false);
    expect(isHiddenElement(el('visibility: collapse'))).toBe(true);
    expect(inlineStyleValues('color: red; --display: none').get('display')).toBeUndefined();
  });
});
