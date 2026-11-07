import { describe, it, expect } from 'vitest';
import { parseRobots, groupFor, isAllowed, botVerdict, normalizePath, allowedWitness } from './robots';

describe('parseRobots and botVerdict (RFC 9309)', () => {
  it('no robots.txt content: every bot is allowed, no group applies', () => {
    expect(botVerdict(parseRobots(''), 'GPTBot')).toEqual({ status: 'allowed', group: 'none' });
  });

  it('Disallow: / for a named bot blocks it; others stay allowed', () => {
    const g = parseRobots('User-agent: GPTBot\nDisallow: /\n');
    expect(botVerdict(g, 'GPTBot')).toEqual({ status: 'blocked', group: 'own' });
    expect(botVerdict(g, 'ClaudeBot')).toEqual({ status: 'allowed', group: 'none' });
  });

  it('Disallow: / with Allow: /public is partial, not blocked', () => {
    const g = parseRobots('User-agent: OAI-SearchBot\nDisallow: /\nAllow: /public\n');
    expect(botVerdict(g, 'OAI-SearchBot').status).toBe('partial');
    const { rules } = groupFor(g, 'OAI-SearchBot');
    expect(isAllowed(rules, '/public/page')).toBe(true);
    expect(isAllowed(rules, '/private')).toBe(false);
  });

  it('a bot without a group of its own follows the "*" group', () => {
    const g = parseRobots('User-agent: *\nDisallow: /\n');
    expect(botVerdict(g, 'PerplexityBot')).toEqual({ status: 'blocked', group: 'wildcard' });
  });

  it('User-agent: * with Allow: / leaves an unnamed bot allowed (RFC 9309 fallback)', () => {
    const g = parseRobots('User-agent: *\nAllow: /\n');
    expect(botVerdict(g, 'GPTBot')).toEqual({ status: 'allowed', group: 'wildcard' });
  });

  it('two groups for the same bot are combined', () => {
    const g = parseRobots('User-agent: GPTBot\nDisallow: /a\n\nUser-agent: Bingbot\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /b\n');
    const { rules } = groupFor(g, 'GPTBot');
    expect(isAllowed(rules, '/a/x')).toBe(false);
    expect(isAllowed(rules, '/b/x')).toBe(false);
    expect(isAllowed(rules, '/c')).toBe(true);
    expect(botVerdict(g, 'GPTBot').status).toBe('partial');
  });

  it('matches the product token case-insensitively, also with a version', () => {
    const g = parseRobots('user-agent: gptbot/1.1\nDISALLOW: /\n');
    expect(botVerdict(g, 'GPTBot')).toEqual({ status: 'blocked', group: 'own' });
  });

  it('several user-agent lines share one group; a sitemap line does not end it', () => {
    const g = parseRobots('User-agent: GPTBot\nUser-agent: ClaudeBot\nSitemap: https://example.com/sitemap.xml\nDisallow: /\n');
    expect(botVerdict(g, 'GPTBot').status).toBe('blocked');
    expect(botVerdict(g, 'ClaudeBot').status).toBe('blocked');
  });

  it('a rule before any user-agent line belongs to no group', () => {
    const g = parseRobots('Disallow: /\nUser-agent: GPTBot\nAllow: /\n');
    expect(botVerdict(g, 'GPTBot').status).toBe('allowed');
  });

  it('an empty Disallow matches nothing', () => {
    const g = parseRobots('User-agent: GPTBot\nDisallow:\n');
    expect(botVerdict(g, 'GPTBot').status).toBe('allowed');
  });

  it('by precedence (Codex, review of bcfe8de, F-006): Disallow: /* with a shorter Allow: / stays blocked', () => {
    expect(botVerdict(parseRobots('User-agent: GPTBot\nDisallow: /*\nAllow: /\n'), 'GPTBot').status).toBe('blocked');
  });

  it('Disallow: /*$ blocks every path', () => {
    const g = parseRobots('User-agent: GPTBot\nDisallow: /*$\n');
    expect(isAllowed(groupFor(g, 'GPTBot').rules, '/a/b')).toBe(false);
    expect(botVerdict(g, 'GPTBot').status).toBe('blocked');
  });

  it('an allow as long as the covering disallow wins its paths: partial (allow wins a tie)', () => {
    expect(botVerdict(parseRobots('User-agent: GPTBot\nDisallow: /*\nAllow: /p\n'), 'GPTBot').status).toBe('partial');
  });

  it('an allow that a longer disallow covers again stays blocked', () => {
    expect(botVerdict(parseRobots('User-agent: GPTBot\nDisallow: /\nAllow: /p\nDisallow: /p*\n'), 'GPTBot').status).toBe('blocked');
  });

  it('an allowed path the old sample paths missed: partial, with the path as witness (Codex, review of 18d2c8d)', () => {
    const g = parseRobots('User-agent: GPTBot\nDisallow: /*\nAllow: /foo*\nDisallow: /f*oo$\nDisallow: /foo*x$\nDisallow: /foo*/x$\n');
    const { rules } = groupFor(g, 'GPTBot');
    for (const p of ['/foo', '/foox', '/foo/x']) expect(isAllowed(rules, p), p).toBe(false);
    expect(isAllowed(rules, '/foo/other')).toBe(true);
    expect(botVerdict(g, 'GPTBot').status).toBe('partial');
    const w = allowedWitness(rules);
    expect(typeof w).toBe('string');
    expect(isAllowed(rules, w as string)).toBe(true);
  });

  it('a "$" inside a pattern is a literal the search can write (Codex, review of e9005a2)', () => {
    const g = parseRobots('User-agent: x\nDisallow: /*\nAllow: /$x\n');
    const { rules } = groupFor(g, 'x');
    expect(isAllowed(rules, '/$x')).toBe(true);
    expect(allowedWitness(rules)).toBe('/$x');
    expect(botVerdict(g, 'x').status).toBe('partial');
    // a trailing "$" stays the anchor
    expect(botVerdict(parseRobots('User-agent: x\nDisallow: /*\nAllow: /a$\n'), 'x').status).toBe('partial');
    expect(allowedWitness(groupFor(parseRobots('User-agent: x\nDisallow: /*\nAllow: /a$\n'), 'x').rules)).toBe('/a');
  });

  it('the search is bounded: past its limit it proves nothing (undefined), which botVerdict reports as partial', () => {
    const rules = groupFor(parseRobots('User-agent: x\nDisallow: /*\nAllow: /x*\nDisallow: /x*y$\nDisallow: /x*z$\n'), 'x').rules;
    expect(allowedWitness(rules, 0)).toBeUndefined();
    expect(typeof allowedWitness(rules)).toBe('string');
  });

  it('blocked only when no path is allowed; many patterns stay quick', () => {
    expect(allowedWitness(groupFor(parseRobots('User-agent: x\nDisallow: /*\nAllow: /\n'), 'x').rules)).toBeNull();
    expect(allowedWitness(groupFor(parseRobots('User-agent: x\nDisallow: /\nAllow: /p\nDisallow: /p*\n'), 'x').rules)).toBeNull();
    expect(botVerdict(parseRobots('User-agent: x\nDisallow: /a\nDisallow: /b\n'), 'x').status).toBe('partial');
    // many overlapping anchored disallows: the search is bounded and never claims "blocked" unproven
    const many = Array.from({ length: 40 }, (_, i) => `Disallow: /*${String.fromCharCode(97 + (i % 26))}*${i}$`).join('\n');
    const v = botVerdict(parseRobots(`User-agent: x\nDisallow: /\nAllow: /k*\n${many}\n`), 'x').status;
    expect(v).toBe('partial');
  });

  it('Disallow: /$ blocks only the root: partial', () => {
    const g = parseRobots('User-agent: GPTBot\nDisallow: /$\n');
    const { rules } = groupFor(g, 'GPTBot');
    expect(isAllowed(rules, '/')).toBe(false);
    expect(isAllowed(rules, '/page')).toBe(true);
    expect(botVerdict(g, 'GPTBot').status).toBe('partial');
  });
});

describe('isAllowed: wildcards, longest match, ties', () => {
  const rules = (txt: string) => groupFor(parseRobots(`User-agent: *\n${txt}`), 'x').rules;

  it('"*" and "$" in rules', () => {
    const r = rules('Disallow: /*.pdf$\n');
    expect(isAllowed(r, '/files/a.pdf')).toBe(false);
    expect(isAllowed(r, '/files/a.pdf?download=1')).toBe(true);
    expect(isAllowed(r, '/files/a.html')).toBe(true);
  });

  it('the longest matching rule wins', () => {
    const r = rules('Disallow: /a\nAllow: /a/b\n');
    expect(isAllowed(r, '/a/b/c')).toBe(true);
    expect(isAllowed(r, '/a/c')).toBe(false);
  });

  it('on a tie between allow and disallow, allow wins', () => {
    const r = rules('Disallow: /p\nAllow: /p\n');
    expect(isAllowed(r, '/p/x')).toBe(true);
  });
});

describe('percent normalisation (RFC 9309, 2.2.2)', () => {
  it('%62 equals b (an unreserved octet is decoded)', () => {
    expect(normalizePath('/foo/%62ar')).toBe('/foo/bar');
    const r = groupFor(parseRobots('User-agent: *\nDisallow: /foo/%62ar\n'), 'x').rules;
    expect(isAllowed(r, '/foo/bar')).toBe(false);
  });

  it('%2f equals %2F (hex digits upper-cased)', () => {
    expect(normalizePath('/a%2fb')).toBe(normalizePath('/a%2Fb'));
    const r = groupFor(parseRobots('User-agent: *\nDisallow: /a%2fb\n'), 'x').rules;
    expect(isAllowed(r, '/a%2Fb')).toBe(false);
  });

  it('%2F is not / (the reserved slash stays encoded)', () => {
    expect(normalizePath('/a%2Fb')).not.toBe('/a/b');
    const r = groupFor(parseRobots('User-agent: *\nDisallow: /a%2Fb\n'), 'x').rules;
    expect(isAllowed(r, '/a/b')).toBe(true);
  });

  it('non-ASCII characters are compared encoded', () => {
    expect(normalizePath('/foo/bar/ツ')).toBe('/foo/bar/%E3%83%84');
    const r = groupFor(parseRobots('User-agent: *\nDisallow: /foo/bar/ツ\n'), 'x').rules;
    expect(isAllowed(r, '/foo/bar/%E3%83%84')).toBe(false);
  });
});
