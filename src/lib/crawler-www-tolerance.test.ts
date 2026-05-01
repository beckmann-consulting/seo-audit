import { describe, it, expect } from 'vitest';
import { sameHostnameWithWww } from './crawler';

describe('sameHostnameWithWww — apex ↔ www', () => {
  it('treats apex and www. as the same origin in both directions', () => {
    expect(sameHostnameWithWww('example.com', 'www.example.com')).toBe(true);
    expect(sameHostnameWithWww('www.example.com', 'example.com')).toBe(true);
  });

  it('returns true for identical hostnames', () => {
    expect(sameHostnameWithWww('example.com', 'example.com')).toBe(true);
    expect(sameHostnameWithWww('www.example.com', 'www.example.com')).toBe(true);
  });
});

describe('sameHostnameWithWww — real subdomains stay distinct', () => {
  it('does NOT treat blog.example.com as equivalent to example.com', () => {
    expect(sameHostnameWithWww('blog.example.com', 'example.com')).toBe(false);
    expect(sameHostnameWithWww('example.com', 'blog.example.com')).toBe(false);
  });

  it('does NOT treat shop.example.com as equivalent to www.example.com', () => {
    expect(sameHostnameWithWww('shop.example.com', 'www.example.com')).toBe(false);
  });

  it('does NOT treat api.example.com as equivalent to apex', () => {
    expect(sameHostnameWithWww('api.example.com', 'example.com')).toBe(false);
  });
});

describe('sameHostnameWithWww — different domains', () => {
  it('returns false for completely different domains', () => {
    expect(sameHostnameWithWww('example.com', 'other.com')).toBe(false);
    expect(sameHostnameWithWww('www.example.com', 'www.other.com')).toBe(false);
  });
});

describe('sameHostnameWithWww — case-insensitivity', () => {
  it('is case-insensitive on both the prefix and the rest of the hostname', () => {
    expect(sameHostnameWithWww('WWW.Example.COM', 'example.com')).toBe(true);
    expect(sameHostnameWithWww('Example.COM', 'WWW.example.com')).toBe(true);
  });
});

describe('sameHostnameWithWww — edge cases', () => {
  it('only strips one leading "www." segment, not arbitrary repetitions', () => {
    // "www.www.example.com" is pathological DNS but possible. We strip
    // exactly ONE leading "www." per hostname, so even compared to a
    // single-www variant the residue still differs ("www.example.com"
    // vs "example.com") and the result is false. That's the safe
    // outcome — pathological inputs stay distinct.
    expect(sameHostnameWithWww('www.www.example.com', 'example.com')).toBe(false);
    expect(sameHostnameWithWww('www.www.example.com', 'www.example.com')).toBe(false);
  });

  it('does NOT match hostnames that merely contain "www" as a substring', () => {
    expect(sameHostnameWithWww('mywww.example.com', 'example.com')).toBe(false);
  });
});
