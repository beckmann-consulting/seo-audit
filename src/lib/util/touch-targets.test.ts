import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import { countSmallTouchTargets, TOUCH_TARGET_THRESHOLD_PX } from './touch-targets';

const count = (html: string, threshold?: number) =>
  countSmallTouchTargets(parse(html), threshold !== undefined ? { threshold } : {});

describe('countSmallTouchTargets — heuristic detection', () => {
  it('returns 0 for a page with no interactive elements', () => {
    expect(count('<div><p>just text</p></div>')).toBe(0);
  });

  it('returns 0 for elements without explicit dimensions (could be CSS-styled)', () => {
    // Without explicit width/height we deliberately don't flag.
    expect(count('<a href="/x">click</a><button>OK</button>')).toBe(0);
  });

  it('flags an icon-only <a> with both inline-style dimensions under 48px', () => {
    expect(count('<a href="/x" style="width: 24px; height: 24px"></a>')).toBe(1);
  });

  it('flags an icon-only <button> with small dimensions', () => {
    expect(count('<button style="width:32px; height:32px">×</button>')).toBe(1);
  });

  it('does NOT flag the same shape when text content is more than 4 characters', () => {
    // Text labels typically get padding from UA stylesheet, so ignore.
    expect(count('<button style="width:24px; height:24px">Submit</button>')).toBe(0);
  });

  it('flags an <a> wrapping a small <img> icon', () => {
    expect(count('<a href="/x"><img src="i.svg" width="20" height="20" alt=""></a>')).toBe(1);
  });

  it('flags an <a> wrapping a small <svg>', () => {
    expect(count('<a href="/x"><svg width="32" height="32"></svg></a>')).toBe(1);
  });

  it('does NOT flag when child img is large enough', () => {
    expect(count('<a href="/x"><img src="i.svg" width="64" height="64" alt=""></a>')).toBe(0);
  });

  it('does NOT flag when only ONE dimension is small (could be very narrow but tall)', () => {
    // Without both axes we can't be confident.
    expect(count('<a href="/x" style="width: 24px"></a>')).toBe(0);
  });

  it('skips <input type="hidden"> entirely', () => {
    expect(count('<input type="hidden" style="width:1px; height:1px">')).toBe(0);
  });

  it('flags small <input type="checkbox"> (interactive, even if compact)', () => {
    expect(count('<input type="checkbox" width="16" height="16">')).toBe(1);
  });

  it('exposes a customisable threshold', () => {
    const html = '<a href="/x" style="width:40px; height:40px"></a>';
    expect(count(html, 32)).toBe(0); // 40 ≥ 32 → not flagged
    expect(count(html, 48)).toBe(1); // 40 < 48 → flagged
  });

  it('processes attribute width/height (no inline style)', () => {
    expect(count('<input type="button" width="20" height="20" value="">')).toBe(1);
  });

  it('handles many candidates efficiently and counts each independently', () => {
    const html =
      '<button style="width:24px;height:24px">A</button>' +
      '<button style="width:60px;height:60px">B</button>' +
      '<a href="/x" style="width:24px;height:24px"></a>';
    expect(count(html)).toBe(2);
  });

  it('uses inline style over attribute when both differ (CSS wins, like browsers)', () => {
    // <input width="80" height="80"> visually 80×80 by HTML attr,
    // but the CSS rule shrinks it to 16×16 (icon-only).
    expect(count('<input type="image" width="80" height="80" style="width:16px;height:16px">')).toBe(1);
  });

  it('exposes the documented WCAG / Material threshold constant', () => {
    expect(TOUCH_TARGET_THRESHOLD_PX).toBe(48);
  });
});
