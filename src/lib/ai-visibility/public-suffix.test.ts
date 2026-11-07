import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import data from './public-suffix-list.json';
import { canonicalHost, parsePublicSuffixList, createPublicSuffixRules, runPublicSuffixCorpus, canonicalRule } from './public-suffix-core';
import { registrableDomain, getDomain, isPublicSuffix } from './public-suffix';

describe('Public Suffix List: the official test corpus (ultimate-40b, Codex F-001)', () => {
  it('every case of tests/test_psl.txt passes against the list in the repo', () => {
    const corpus = readFileSync(join(__dirname, '__fixtures__/test_psl.txt'), 'utf8');
    const r = runPublicSuffixCorpus(corpus, createPublicSuffixRules((data as { rules: string[] }).rules));
    expect(r.cases).toBeGreaterThanOrEqual(78);
    expect(r.failures).toEqual([]);
  });
  it('the data file names its source, date and license and has both sections', () => {
    const d = data as { source: string; fetched: string; license: string; icannRules: number; privateRules: number; rules: string[] };
    expect(d.source).toBe('https://publicsuffix.org/list/public_suffix_list.dat');
    expect(d.fetched).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.license).toMatch(/MPL-2\.0/);
    expect(d.icannRules).toBeGreaterThan(5000);
    expect(d.privateRules).toBeGreaterThan(1000);
    expect(d.rules).toHaveLength(d.icannRules + d.privateRules);
    expect(d.rules).toContain('github.io');
  });
});

describe('registrable domain for the scope', () => {
  it('names, wildcards and exceptions', () => {
    expect(registrableDomain('beckmanndigital.com')).toBe('beckmanndigital.com');
    expect(registrableDomain('umami.beckmanndigital.com')).toBe('beckmanndigital.com');
    expect(registrableDomain('a.b.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('bar.foo.ck')).toBe('bar.foo.ck'); // *.ck
    expect(registrableDomain('a.www.ck')).toBe('www.ck'); // !www.ck
  });
  it('the github.io boundary: two projects are two domains, github.io itself has none', () => {
    expect(registrableDomain('a.github.io')).toBe('a.github.io');
    expect(registrableDomain('b.github.io')).toBe('b.github.io');
    expect(registrableDomain('x.a.github.io')).toBe('a.github.io');
    expect(registrableDomain('github.io')).toBeNull();
  });
  it('null for an IP address, an invalid host and a host only the default rule covers', () => {
    expect(registrableDomain('93.184.215.14')).toBeNull();
    expect(registrableDomain('site.test')).toBeNull(); // no listed rule: the old rule holds
    expect(registrableDomain('beckmanndigital.com.')).toBeNull();
    expect(registrableDomain('')).toBeNull();
    // the official semantics with the default rule, as the corpus defines it
    expect(getDomain('a.site.test')).toBe('site.test');
  });
  it('case and IDN give one canonical form (Codex F-003)', () => {
    expect(registrableDomain('UMAMI.BeckmannDigital.COM')).toBe('beckmanndigital.com');
    expect(canonicalHost('bücher.de')).toBe('xn--bcher-kva.de');
    expect(registrableDomain('shop.bücher.de')).toBe(registrableDomain('shop.xn--bcher-kva.de'));
    expect(registrableDomain('shop.bücher.de')).toBe('xn--bcher-kva.de');
  });
  it('public suffix by the full semantics, not by the literal rule (Codex, round 2, F-001)', () => {
    expect(isPublicSuffix('foo.ck')).toBe(true); // through *.ck, no literal rule
    expect(isPublicSuffix('www.ck')).toBe(false); // !www.ck
    expect(isPublicSuffix('com')).toBe(true);
    expect(isPublicSuffix('github.io')).toBe(true);
    expect(isPublicSuffix('a.github.io')).toBe(false);
  });
});

describe('canonicalHost', () => {
  it('rejects leading and trailing dots, empty and long labels, other characters', () => {
    for (const bad of ['.a.com', 'a.com.', 'a..com', `${'x'.repeat(64)}.com`, 'a_b.com', 'a b.com', '[::1]', '', null]) {
      expect(canonicalHost(bad as string | null), String(bad)).toBeNull();
    }
    expect(canonicalHost('A.Com')).toBe('a.com');
  });
});

describe('parsing public_suffix_list.dat (update script)', () => {
  const wrap = (icann: string, priv = 'example.org') => `// header\n// ===BEGIN ICANN DOMAINS===\n${icann}\n// ===END ICANN DOMAINS===\n// ===BEGIN PRIVATE DOMAINS===\n${priv}\n// ===END PRIVATE DOMAINS===\n`;
  it('reads a rule up to the first whitespace: a trailing comment is allowed (Codex, round 2, F-002)', () => {
    expect(parsePublicSuffixList(wrap('com // Kommentar\n*.ck\n!www.ck\n// a comment\n\n食狮.中国')).icann)
      .toEqual(['com', '*.ck', '!www.ck', canonicalHost('食狮.中国')]);
  });
  it('refuses missing or doubled markers, rules outside the sections and invalid rules', () => {
    expect(() => parsePublicSuffixList('com\n')).toThrow(/outside/);
    expect(() => parsePublicSuffixList(wrap('com').replace('// ===END PRIVATE DOMAINS===\n', ''))).toThrow();
    expect(() => parsePublicSuffixList(wrap('com') + '// ===BEGIN ICANN DOMAINS===\n// ===END ICANN DOMAINS===\n')).toThrow(/out of order or repeated/);
    // PRIVATE before ICANN, and a marker inside another line (Codex, review of 58d270e)
    const swapped = '// ===BEGIN PRIVATE DOMAINS===\nexample.org\n// ===END PRIVATE DOMAINS===\n// ===BEGIN ICANN DOMAINS===\ncom\n// ===END ICANN DOMAINS===\n';
    expect(() => parsePublicSuffixList(swapped)).toThrow(/out of order/);
    expect(() => parsePublicSuffixList(wrap('com // ===END ICANN DOMAINS===\nnet'))).toThrow(/not a line of its own/);
    expect(() => parsePublicSuffixList(wrap('a..com'))).toThrow(/no valid name/);
    expect(() => parsePublicSuffixList(wrap('a.*.com'))).toThrow(/wildcard/);
    expect(() => parsePublicSuffixList(wrap('!www.zz'))).toThrow(/without a matching wildcard/);
    expect(() => canonicalRule('*')).toThrow();
  });
});
