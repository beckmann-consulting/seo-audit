import { describe, it, expect } from 'vitest';
import { resolveGscProperty, describeVariant } from './property-resolver';

describe('resolveGscProperty — variant ordering', () => {
  it('prefers sc-domain (Domain Property) over URL-prefix variants', () => {
    const sites = [
      'https://example.com/',
      'sc-domain:example.com',
      'https://www.example.com/',
    ];
    const r = resolveGscProperty('example.com', sites);
    expect(r).toEqual({ siteUrl: 'sc-domain:example.com', variant: 'domain' });
  });

  it('falls through to https URL-prefix when no Domain Property exists', () => {
    expect(resolveGscProperty('example.com', ['https://example.com/']))
      .toEqual({ siteUrl: 'https://example.com/', variant: 'https' });
  });

  it('falls through to http URL-prefix when neither domain nor https exists', () => {
    expect(resolveGscProperty('example.com', ['http://example.com/']))
      .toEqual({ siteUrl: 'http://example.com/', variant: 'http' });
  });

  it('falls through to https-www variant', () => {
    expect(resolveGscProperty('example.com', ['https://www.example.com/']))
      .toEqual({ siteUrl: 'https://www.example.com/', variant: 'https-www' });
  });

  it('falls through to http-www variant', () => {
    expect(resolveGscProperty('example.com', ['http://www.example.com/']))
      .toEqual({ siteUrl: 'http://www.example.com/', variant: 'http-www' });
  });

  it('returns null when no variant matches', () => {
    expect(resolveGscProperty('example.com', [
      'sc-domain:other.com',
      'https://different-site.com/',
    ])).toBeNull();
  });
});

describe('resolveGscProperty — www-prefix handling', () => {
  it('strips leading www. from input domain when matching against sc-domain', () => {
    expect(resolveGscProperty('www.example.com', ['sc-domain:example.com']))
      .toEqual({ siteUrl: 'sc-domain:example.com', variant: 'domain' });
  });

  it('audits on www.example.com still match the bare https://example.com/ property', () => {
    expect(resolveGscProperty('www.example.com', ['https://example.com/']))
      .toEqual({ siteUrl: 'https://example.com/', variant: 'https' });
  });

  it('case-insensitive match (input is uppercased)', () => {
    expect(resolveGscProperty('EXAMPLE.COM', ['sc-domain:example.com']))
      .toEqual({ siteUrl: 'sc-domain:example.com', variant: 'domain' });
  });
});

describe('describeVariant', () => {
  it('returns German labels by default', () => {
    expect(describeVariant('domain')).toBe('Domain-Property');
    expect(describeVariant('https')).toBe('URL-Property: https://');
    expect(describeVariant('http-www')).toBe('URL-Property: http://www.');
  });

  it('returns English labels when lang=en', () => {
    expect(describeVariant('domain', 'en')).toBe('Domain property');
    expect(describeVariant('https', 'en')).toBe('URL property: https://');
  });
});
