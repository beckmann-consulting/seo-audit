import { describe, it, expect } from 'vitest';
import { normaliseUrl } from './url-normalize';

describe('normaliseUrl', () => {
  it('strips a trailing slash on a non-root path', () => {
    expect(normaliseUrl('https://example.com/about/')).toBe('https://example.com/about');
  });

  it('preserves the trailing slash on a bare-host path "/"', () => {
    expect(normaliseUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('drops the URL fragment', () => {
    expect(normaliseUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });

  it('returns the input verbatim for malformed URLs', () => {
    expect(normaliseUrl('not a url')).toBe('not a url');
  });

  it('combines all rules in one pass', () => {
    expect(normaliseUrl('https://example.com/blog/#top')).toBe('https://example.com/blog');
  });

  it('preserves the query string', () => {
    expect(normaliseUrl('https://example.com/search?q=foo')).toBe('https://example.com/search?q=foo');
  });
});
