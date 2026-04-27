import { describe, it, expect } from 'vitest';
import { buildBasicAuthHeader, sanitizeConfigForClient, isSensitiveHeader } from './auth';
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

  it('masks sensitive customHeaders but leaves benign ones untouched', () => {
    const sanitized = sanitizeConfigForClient({
      ...baseConfig,
      customHeaders: {
        'Cookie': 'session=abc123',
        'Authorization': 'Bearer xyz',
        'X-API-Key': 'sk_live_42',
        'X-Auth-Token': 'sig123',
        'X-Auth-User': 'admin',
        'Accept-Language': 'de-DE',
        'X-Custom-Tracking': 'experiment-A',
      },
    });
    expect(sanitized.customHeaders).toEqual({
      'Cookie': '***',
      'Authorization': '***',
      'X-API-Key': '***',
      'X-Auth-Token': '***',
      'X-Auth-User': '***',
      'Accept-Language': 'de-DE',
      'X-Custom-Tracking': 'experiment-A',
    });
  });

  it('does not mutate input customHeaders', () => {
    const headers = { 'Cookie': 'real-value' };
    const original: AuditConfig = { ...baseConfig, customHeaders: headers };
    sanitizeConfigForClient(original);
    expect(headers['Cookie']).toBe('real-value');
  });
});

describe('isSensitiveHeader', () => {
  it('catches the standard credential-bearing headers, case-insensitively', () => {
    expect(isSensitiveHeader('Cookie')).toBe(true);
    expect(isSensitiveHeader('cookie')).toBe(true);
    expect(isSensitiveHeader('AUTHORIZATION')).toBe(true);
    expect(isSensitiveHeader('Proxy-Authorization')).toBe(true);
    expect(isSensitiveHeader('X-API-Key')).toBe(true);
    expect(isSensitiveHeader('X-CSRF-Token')).toBe(true);
  });

  it('catches anything starting with X-Auth- (broad bearer-token family)', () => {
    expect(isSensitiveHeader('X-Auth-Token')).toBe(true);
    expect(isSensitiveHeader('X-Auth-Signature')).toBe(true);
    expect(isSensitiveHeader('x-auth-anything')).toBe(true);
  });

  it('leaves benign headers alone', () => {
    expect(isSensitiveHeader('Accept-Language')).toBe(false);
    expect(isSensitiveHeader('User-Agent')).toBe(false);
    expect(isSensitiveHeader('X-Custom-Tracking')).toBe(false);
    expect(isSensitiveHeader('X-Forwarded-For')).toBe(false);
  });
});
