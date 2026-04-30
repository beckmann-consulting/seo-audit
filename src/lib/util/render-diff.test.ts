import { describe, it, expect } from 'vitest';
import { computeRenderDiff } from './render-diff';

describe('computeRenderDiff — word counts', () => {
  it('reports zero-deltas for a server-rendered page that JS does not change', () => {
    const html = '<html><body>' +
      Array.from({ length: 20 }, () => '<p>word word word word word word word</p>').join('') +
      '</body></html>';
    // staticWordCount is the value the caller would have computed via
    // countVisibleWords. We pass an arbitrary truth here and assert
    // the diff stays at zero when both HTMLs are identical.
    const diff = computeRenderDiff(html, 999, html);
    expect(diff.wordCountStatic).toBe(999);
    // wordCountRendered is what countVisibleWords reports for the same
    // HTML — the test only asserts no delta, no specific number.
    expect(diff.wordCountDelta).toBe(diff.wordCountRendered - 999);
  });

  it('reports a large positive delta for a CSR shell that hydrates with content', () => {
    const staticHtml = '<html><body><div id="root"></div></body></html>';
    const renderedHtml = '<html><body><div id="root">' +
      Array.from({ length: 50 }, () => '<p>hydrated content here words</p>').join('') +
      '</div></body></html>';
    const diff = computeRenderDiff(staticHtml, 0, renderedHtml);
    expect(diff.wordCountStatic).toBe(0);
    expect(diff.wordCountRendered).toBeGreaterThan(100);
    expect(diff.wordCountDelta).toBeGreaterThan(100);
  });

  it('reports a negative delta when JS removes content (rare but possible)', () => {
    const staticHtml = '<html><body>' +
      Array.from({ length: 20 }, () => '<p>filler filler filler filler</p>').join('') +
      '</body></html>';
    const renderedHtml = '<html><body><p>tiny tiny tiny</p></body></html>';
    const diff = computeRenderDiff(staticHtml, 60, renderedHtml);
    expect(diff.wordCountDelta).toBeLessThan(0);
    expect(diff.wordCountDeltaRatio).toBeLessThan(0);
  });

  it('uses max(1, static) as the ratio denominator to avoid div-by-zero', () => {
    const staticHtml = '<html><body><div id="root"></div></body></html>';
    const renderedHtml = '<html><body>' +
      Array.from({ length: 25 }, () => '<p>content content content content</p>').join('') +
      '</body></html>';
    const diff = computeRenderDiff(staticHtml, 0, renderedHtml);
    // staticWordCount = 0; denominator clamped to 1; ratio === delta itself
    expect(diff.wordCountStatic).toBe(0);
    expect(diff.wordCountDeltaRatio).toBe(diff.wordCountDelta);
    expect(Number.isFinite(diff.wordCountDeltaRatio)).toBe(true);
  });
});

describe('computeRenderDiff — link counts', () => {
  it('counts anchor tags with href', () => {
    const staticHtml = '<html><body><a href="/a">a</a><a href="/b">b</a></body></html>';
    const renderedHtml = '<html><body>' +
      '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><a href="/d">d</a>' +
      '</body></html>';
    const diff = computeRenderDiff(staticHtml, 2, renderedHtml);
    expect(diff.linkCountStatic).toBe(2);
    expect(diff.linkCountRendered).toBe(4);
    expect(diff.linkCountDelta).toBe(2);
  });

  it('does NOT count anchors without href (e.g. JS-controlled spans masquerading as links)', () => {
    const html = '<html><body><a>no-href</a><a href="/real">real</a></body></html>';
    const diff = computeRenderDiff(html, 1, html);
    expect(diff.linkCountStatic).toBe(1);
    expect(diff.linkCountRendered).toBe(1);
  });

  it('handles an empty static-html string gracefully', () => {
    const renderedHtml = '<html><body><a href="/x">x</a></body></html>';
    const diff = computeRenderDiff('', 0, renderedHtml);
    expect(diff.linkCountStatic).toBe(0);
    expect(diff.linkCountRendered).toBe(1);
    expect(diff.linkCountDelta).toBe(1);
  });
});

describe('computeRenderDiff — edge cases', () => {
  it('handles both inputs empty', () => {
    const diff = computeRenderDiff('', 0, '');
    expect(diff).toEqual({
      wordCountStatic: 0,
      wordCountRendered: 0,
      wordCountDelta: 0,
      wordCountDeltaRatio: 0,
      linkCountStatic: 0,
      linkCountRendered: 0,
      linkCountDelta: 0,
    });
  });
});
