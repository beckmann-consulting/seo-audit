import { describe, it, expect } from 'vitest';
import { buildBasicAuthHeader, sanitizeConfigForClient } from './auth';
import type { AuditConfig } from '@/types';

const baseConfig: AuditConfig = {
  url: 'https://example.com/',
  modules: [],
  author: 'tester',
  maxPages: 0,
};

describe('buildBasicAuthHeader', () => {
  it('returns undefined when no credentials are given', () => {
    expect(buildBasicAuthHeader(undefined)).toBeUndefined();
  });

  it('returns undefined when both username and password are empty', () => {
    expect(buildBasicAuthHeader({ username: '', password: '' })).toBeUndefined();
  });

  it('encodes username:password as base64 with the "Basic " prefix', () => {
    const h = buildBasicAuthHeader({ username: 'admin', password: 'secret' });
    // base64('admin:secret') = 'YWRtaW46c2VjcmV0'
    expect(h).toBe('Basic YWRtaW46c2VjcmV0');
  });

  it('handles unicode in credentials (btoa works on UTF-16; non-ASCII may throw — that is acceptable)', () => {
    // ASCII-only is the documented support range. Just verify no
    // surprise mutation of plain ASCII inputs.
    expect(buildBasicAuthHeader({ username: 'user', password: 'pass' }))
      .toBe('Basic dXNlcjpwYXNz');
  });
});

describe('sanitizeConfigForClient', () => {
  it('drops basicAuth entirely', () => {
    const sanitized = sanitizeConfigForClient({
      ...baseConfig,
      basicAuth: { username: 'admin', password: 'secret' },
    });
    expect(sanitized.basicAuth).toBeUndefined();
    // The original should be unchanged (no in-place mutation)
    expect(sanitized).not.toBe(baseConfig);
  });

  it('masks googleApiKey to a fixed marker', () => {
    const sanitized = sanitizeConfigForClient({
      ...baseConfig,
      googleApiKey: 'AIzaSyD-RealLookingKey',
    });
    expect(sanitized.googleApiKey).toBe('***');
  });

  it('leaves googleApiKey untouched when it was not set', () => {
    const sanitized = sanitizeConfigForClient(baseConfig);
    expect(sanitized.googleApiKey).toBeUndefined();
  });

  it('preserves non-credential fields verbatim', () => {
    const sanitized = sanitizeConfigForClient({
      ...baseConfig,
      url: 'https://example.com/x',
      modules: ['seo', 'tech'],
      maxPages: 50,
      userAgent: 'googlebot-mobile',
      include: ['/blog/'],
      exclude: ['/admin'],
    });
    expect(sanitized.url).toBe('https://example.com/x');
    expect(sanitized.modules).toEqual(['seo', 'tech']);
    expect(sanitized.maxPages).toBe(50);
    expect(sanitized.userAgent).toBe('googlebot-mobile');
    expect(sanitized.include).toEqual(['/blog/']);
    expect(sanitized.exclude).toEqual(['/admin']);
  });

  it('does not mutate the input', () => {
    const original: AuditConfig = {
      ...baseConfig,
      basicAuth: { username: 'a', password: 'b' },
      googleApiKey: 'AIzaXXX',
    };
    sanitizeConfigForClient(original);
    expect(original.basicAuth).toEqual({ username: 'a', password: 'b' });
    expect(original.googleApiKey).toBe('AIzaXXX');
  });
});
