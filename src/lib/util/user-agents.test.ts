import { describe, it, expect } from 'vitest';
import { resolveUserAgent, getRobotsToken } from './user-agents';

describe('resolveUserAgent', () => {
  it('returns the default UA when nothing is configured', () => {
    expect(resolveUserAgent(undefined)).toContain('SEOAuditPro');
    expect(resolveUserAgent({})).toContain('SEOAuditPro');
  });

  it('returns the default UA when preset is "default"', () => {
    expect(resolveUserAgent({ userAgent: 'default' })).toContain('SEOAuditPro');
  });

  it('returns the Googlebot Mobile UA for googlebot-mobile preset', () => {
    const ua = resolveUserAgent({ userAgent: 'googlebot-mobile' });
    expect(ua).toContain('Googlebot');
    expect(ua).toContain('Mobile');
    expect(ua).toContain('Android');
  });

  it('returns the Googlebot Desktop UA for googlebot-desktop preset', () => {
    const ua = resolveUserAgent({ userAgent: 'googlebot-desktop' });
    expect(ua).toContain('Googlebot');
    expect(ua).not.toContain('Mobile');
  });

  it('returns the Bingbot UA for bingbot preset', () => {
    expect(resolveUserAgent({ userAgent: 'bingbot' })).toContain('bingbot');
  });

  it('returns AI bot UAs', () => {
    expect(resolveUserAgent({ userAgent: 'gptbot' })).toContain('GPTBot');
    expect(resolveUserAgent({ userAgent: 'claudebot' })).toContain('ClaudeBot');
    expect(resolveUserAgent({ userAgent: 'perplexitybot' })).toContain('PerplexityBot');
  });

  it('uses customUserAgent when preset is custom', () => {
    const ua = resolveUserAgent({ userAgent: 'custom', customUserAgent: 'MyCrawler/1.0' });
    expect(ua).toBe('MyCrawler/1.0');
  });

  it('falls back to default when custom is selected but the string is empty', () => {
    expect(resolveUserAgent({ userAgent: 'custom', customUserAgent: '' })).toContain('SEOAuditPro');
    expect(resolveUserAgent({ userAgent: 'custom', customUserAgent: '   ' })).toContain('SEOAuditPro');
    expect(resolveUserAgent({ userAgent: 'custom' })).toContain('SEOAuditPro');
  });

  it('trims the custom UA before using it', () => {
    expect(resolveUserAgent({ userAgent: 'custom', customUserAgent: '  TestBot/2  ' })).toBe('TestBot/2');
  });
});

describe('getRobotsToken', () => {
  it('returns empty string for default and custom', () => {
    expect(getRobotsToken({ userAgent: 'default' })).toBe('');
    expect(getRobotsToken({ userAgent: 'custom' })).toBe('');
    expect(getRobotsToken(undefined)).toBe('');
  });

  it('returns "googlebot" for both Googlebot variants', () => {
    expect(getRobotsToken({ userAgent: 'googlebot-mobile' })).toBe('googlebot');
    expect(getRobotsToken({ userAgent: 'googlebot-desktop' })).toBe('googlebot');
  });

  it('returns the matching robots-token per AI bot preset', () => {
    expect(getRobotsToken({ userAgent: 'bingbot' })).toBe('bingbot');
    expect(getRobotsToken({ userAgent: 'gptbot' })).toBe('gptbot');
    expect(getRobotsToken({ userAgent: 'claudebot' })).toBe('claudebot');
    expect(getRobotsToken({ userAgent: 'perplexitybot' })).toBe('perplexitybot');
  });
});
