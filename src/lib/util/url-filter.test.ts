import { describe, it, expect } from 'vitest';
import {
  compileFilterPatterns,
  urlMatches,
  FilterPatternError,
} from './url-filter';

describe('compileFilterPatterns', () => {
  it('returns an empty array for undefined input', () => {
    expect(compileFilterPatterns(undefined)).toEqual([]);
  });

  it('compiles a list of valid patterns', () => {
    const re = compileFilterPatterns(['^https://', '/blog/']);
    expect(re).toHaveLength(2);
    expect(re[0]).toBeInstanceOf(RegExp);
  });

  it('drops blank / whitespace-only entries silently', () => {
    const re = compileFilterPatterns(['', '  ', '/x', '\n']);
    expect(re).toHaveLength(1);
  });

  it('throws FilterPatternError on a syntactically invalid regex', () => {
    expect(() => compileFilterPatterns(['(unclosed']))
      .toThrowError(FilterPatternError);
  });

  it('FilterPatternError carries the offending pattern', () => {
    try {
      compileFilterPatterns(['/ok', '(bad']);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(FilterPatternError);
      expect((err as FilterPatternError).pattern).toBe('(bad');
    }
  });
});

describe('urlMatches', () => {
  const URL = 'https://example.com/blog/post-1?utm_source=x';

  it('lets every URL through with no filters at all', () => {
    expect(urlMatches(URL, [], [])).toBe(true);
  });

  it('exclude-only: drops matching URLs, keeps non-matching ones', () => {
    const exc = compileFilterPatterns(['/admin']);
    expect(urlMatches('https://example.com/admin/x', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/blog/x', [], exc)).toBe(true);
  });

  it('include-only: keeps matching URLs, drops non-matching ones', () => {
    const inc = compileFilterPatterns(['/blog/']);
    expect(urlMatches('https://example.com/blog/x', inc, [])).toBe(true);
    expect(urlMatches('https://example.com/about', inc, [])).toBe(false);
  });

  it('exclude wins over include', () => {
    const inc = compileFilterPatterns(['/blog/']);
    const exc = compileFilterPatterns(['/blog/draft']);
    expect(urlMatches('https://example.com/blog/post', inc, exc)).toBe(true);
    expect(urlMatches('https://example.com/blog/draft', inc, exc)).toBe(false);
  });

  it('handles spec-mentioned patterns (/admin, ?utm_, .pdf$)', () => {
    const exc = compileFilterPatterns(['/admin', '\\?utm_', '\\.pdf$']);
    expect(urlMatches('https://example.com/admin/x', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/x?utm_source=foo', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/files/report.pdf', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/blog/post', [], exc)).toBe(true);
  });

  it('ANY include matches → keep (not all)', () => {
    const inc = compileFilterPatterns(['/blog/', '/products/']);
    expect(urlMatches('https://example.com/blog/x', inc, [])).toBe(true);
    expect(urlMatches('https://example.com/products/x', inc, [])).toBe(true);
    expect(urlMatches('https://example.com/about', inc, [])).toBe(false);
  });

  it('ANY exclude matches → drop (not all)', () => {
    const exc = compileFilterPatterns(['/admin', '/staging']);
    expect(urlMatches('https://example.com/admin', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/staging', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/blog', [], exc)).toBe(true);
  });

  it('matches are tested against the full URL (scheme + host + path)', () => {
    // Anchor on protocol or host
    const exc = compileFilterPatterns(['^http://', 'staging\\.example\\.com']);
    expect(urlMatches('http://example.com/x', [], exc)).toBe(false);
    expect(urlMatches('https://staging.example.com/x', [], exc)).toBe(false);
    expect(urlMatches('https://example.com/x', [], exc)).toBe(true);
  });
});
