import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import { detectCsrFromRoot, detectCsrFromHtml } from './csr-detection';

describe('detectCsrFromRoot — SPA shell detection', () => {
  it('flags an empty React #root as client-rendered', () => {
    const root = parse('<html><body><div id="root"></div></body></html>');
    const r = detectCsrFromRoot(root, 0);
    expect(r.likelyClientRendered).toBe(true);
    expect(r.signal).toContain('React #root');
    expect(r.signal).toContain('0 chars');
  });

  it('flags a near-empty #app (< 100 chars) as client-rendered', () => {
    const root = parse('<html><body><div id="app">Loading…</div></body></html>');
    const r = detectCsrFromRoot(root, 1);
    expect(r.likelyClientRendered).toBe(true);
    expect(r.signal).toContain('Vue/generic #app');
  });

  it('does NOT flag #root that has been server-rendered (>= 100 chars inside)', () => {
    const filler = 'A'.repeat(150);
    const root = parse(`<html><body><div id="root">${filler}</div></body></html>`);
    const r = detectCsrFromRoot(root, 30);
    expect(r.likelyClientRendered).toBe(false);
    expect(r.signal).toBeUndefined();
  });

  it('flags an empty Next.js #__next', () => {
    const root = parse('<html><body><div id="__next"></div></body></html>');
    const r = detectCsrFromRoot(root, 0);
    expect(r.likelyClientRendered).toBe(true);
    expect(r.signal).toContain('Next.js #__next');
  });

  it('flags an empty data-reactroot element', () => {
    const root = parse('<html><body><main data-reactroot></main></body></html>');
    const r = detectCsrFromRoot(root, 0);
    expect(r.likelyClientRendered).toBe(true);
    expect(r.signal).toContain('React data-reactroot');
  });
});

describe('detectCsrFromRoot — noscript fallback', () => {
  it('flags low-word page WITH substantive <noscript> as client-rendered', () => {
    const noscriptText = 'You need to enable JavaScript to run this app. Please enable it in your browser.';
    const root = parse(`<html><body><noscript>${noscriptText}</noscript></body></html>`);
    const r = detectCsrFromRoot(root, 5);
    expect(r.likelyClientRendered).toBe(true);
    expect(r.signal).toContain('noscript');
  });

  it('does NOT flag low-word page WITHOUT a substantive noscript', () => {
    const root = parse('<html><body><p>Short page</p></body></html>');
    const r = detectCsrFromRoot(root, 2);
    expect(r.likelyClientRendered).toBe(false);
  });

  it('does NOT flag low-word page with a tiny noscript (<= 50 chars)', () => {
    const root = parse('<html><body><noscript>Enable JS</noscript></body></html>');
    const r = detectCsrFromRoot(root, 2);
    expect(r.likelyClientRendered).toBe(false);
  });

  it('does NOT trigger noscript path when wordCount is healthy', () => {
    const noscriptText = 'You need to enable JavaScript to run this app. Please enable it in your browser.';
    const root = parse(`<html><body><noscript>${noscriptText}</noscript></body></html>`);
    const r = detectCsrFromRoot(root, 200);
    expect(r.likelyClientRendered).toBe(false);
  });
});

describe('detectCsrFromRoot — priority', () => {
  it('SPA-root detection wins over noscript when both apply', () => {
    const root = parse(
      '<html><body><div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript></body></html>',
    );
    const r = detectCsrFromRoot(root, 5);
    expect(r.likelyClientRendered).toBe(true);
    expect(r.signal).toContain('React #root');
  });
});

describe('detectCsrFromHtml — convenience entry point', () => {
  it('parses + counts words from raw HTML and flags an empty React shell', () => {
    const html = '<html><body><div id="root"></div></body></html>';
    const r = detectCsrFromHtml(html);
    expect(r.likelyClientRendered).toBe(true);
  });

  it('returns no-CSR for a normal server-rendered page', () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `<p>This is paragraph number ${i} with substantive content that goes well past the threshold.</p>`,
    ).join('');
    const html = `<html><body><h1>Hello</h1>${paragraphs}</body></html>`;
    const r = detectCsrFromHtml(html);
    expect(r.likelyClientRendered).toBe(false);
  });
});
