import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBingApiKey } from './auth';

describe('getBingApiKey', () => {
  const originalKey = process.env.BING_WMT_API_KEY;

  beforeEach(() => {
    delete process.env.BING_WMT_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.BING_WMT_API_KEY;
    else process.env.BING_WMT_API_KEY = originalKey;
  });

  it('returns null when the env var is unset', () => {
    expect(getBingApiKey()).toBeNull();
  });

  it('returns null when the env var is the empty string', () => {
    process.env.BING_WMT_API_KEY = '';
    expect(getBingApiKey()).toBeNull();
  });

  it('returns null when the env var contains only whitespace', () => {
    process.env.BING_WMT_API_KEY = '   ';
    expect(getBingApiKey()).toBeNull();
  });

  it('returns the trimmed key when set', () => {
    process.env.BING_WMT_API_KEY = '  abc123key  ';
    expect(getBingApiKey()).toBe('abc123key');
  });

  it('returns the key verbatim when no surrounding whitespace', () => {
    process.env.BING_WMT_API_KEY = 'plainkey';
    expect(getBingApiKey()).toBe('plainkey');
  });
});
