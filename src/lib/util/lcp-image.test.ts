import { describe, it, expect } from 'vitest';
import { analyzeLcpImage, describeImageHints } from './lcp-image';

describe('analyzeLcpImage', () => {
  it('returns the empty shape for undefined / non-image snippets', () => {
    const empty = {
      isImage: false,
      isLazy: false,
      hasFetchPriorityHigh: false,
      hasDimensions: false,
    };
    expect(analyzeLcpImage(undefined)).toEqual(empty);
    expect(analyzeLcpImage('')).toEqual(empty);
    expect(analyzeLcpImage('<div class="hero">Welcome</div>')).toEqual(empty);
    expect(analyzeLcpImage('<h1>Welcome</h1>')).toEqual(empty);
    expect(analyzeLcpImage('<p>Some text</p>')).toEqual(empty);
  });

  it('detects an <img> tag', () => {
    const r = analyzeLcpImage('<img src="hero.jpg" alt="hero">');
    expect(r.isImage).toBe(true);
    expect(r.src).toBe('hero.jpg');
  });

  it('flags loading="lazy"', () => {
    const r = analyzeLcpImage('<img src="hero.jpg" loading="lazy">');
    expect(r.isImage).toBe(true);
    expect(r.isLazy).toBe(true);
  });

  it('flags missing fetchpriority="high"', () => {
    const r = analyzeLcpImage('<img src="hero.jpg" alt="hero">');
    expect(r.hasFetchPriorityHigh).toBe(false);
  });

  it('detects fetchpriority="high"', () => {
    const r = analyzeLcpImage('<img src="hero.jpg" fetchpriority="high">');
    expect(r.hasFetchPriorityHigh).toBe(true);
  });

  it('requires BOTH width and height for hasDimensions', () => {
    expect(analyzeLcpImage('<img src="x" width="100">').hasDimensions).toBe(false);
    expect(analyzeLcpImage('<img src="x" height="100">').hasDimensions).toBe(false);
    expect(analyzeLcpImage('<img src="x" width="100" height="50">').hasDimensions).toBe(true);
  });

  it('handles a leading newline / whitespace before <img>', () => {
    const r = analyzeLcpImage('\n  <img src="x" loading="lazy">');
    expect(r.isImage).toBe(true);
    expect(r.isLazy).toBe(true);
  });

  it('does not match <image> (SVG element) as <img>', () => {
    expect(analyzeLcpImage('<image href="x.svg"></image>').isImage).toBe(false);
  });
});

describe('describeImageHints', () => {
  it('returns empty hints for non-image elements', () => {
    const r = describeImageHints(analyzeLcpImage('<div>x</div>'));
    expect(r.de).toEqual([]);
    expect(r.en).toEqual([]);
  });

  it('returns one bilingual hint per problem (and same count in DE/EN)', () => {
    // Lazy + missing fetchpriority + missing dimensions = 3 hints in each lang
    const r = describeImageHints(analyzeLcpImage('<img src="x" loading="lazy">'));
    expect(r.de).toHaveLength(3);
    expect(r.en).toHaveLength(3);
  });

  it('lists no hints when the image is set up correctly', () => {
    const r = describeImageHints(analyzeLcpImage(
      '<img src="hero.jpg" fetchpriority="high" width="1200" height="600">'
    ));
    expect(r.de).toEqual([]);
    expect(r.en).toEqual([]);
  });

  it('mentions lazy explicitly when the image is lazy-loaded', () => {
    const r = describeImageHints(analyzeLcpImage('<img src="x" loading="lazy" fetchpriority="high" width="1" height="1">'));
    expect(r.en[0]).toMatch(/loading="lazy"/);
    expect(r.de[0]).toMatch(/lazy/);
  });
});
