// The Public Suffix List algorithm (https://github.com/publicsuffix/list/wiki/Format)
// without data and without path aliases, so that both the app and
// scripts/update-public-suffix-list.mjs (plain Node, type stripping) can use it
// (ultimate-40b, plan section 10).
//
// - Rules: a name (`co.uk`), a wildcard (`*.ck`: any one label left of `ck`) or
//   an exception (`!www.ck`). An exception prevails over every other rule;
//   otherwise the matching rule with the most labels wins; without any, the
//   default rule `*` (the last label) applies.
// - Hosts and rules are compared in one canonical form: lower case, Punycode,
//   no leading or trailing dot, no empty label (canonicalHost).

import { domainToASCII } from 'node:url';

/** A host in canonical form: lower case and Punycode; null for anything that is no plain host name. */
export function canonicalHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.startsWith('.') || raw.endsWith('.')) return null;
  const ascii = domainToASCII(raw.toLowerCase());
  if (!ascii || ascii.length > 253) return null;
  const labels = ascii.split('.');
  for (const l of labels) {
    if (l.length === 0 || l.length > 63 || !/^[a-z0-9-]+$/.test(l)) return null;
  }
  return ascii;
}

export interface ParsedList { icann: string[]; private: string[] }

const MARKERS = ['===BEGIN ICANN DOMAINS===', '===END ICANN DOMAINS===', '===BEGIN PRIVATE DOMAINS===', '===END PRIVATE DOMAINS==='];

/** One rule in canonical form (`*.` and `!` kept); throws for an invalid rule. */
export function canonicalRule(token: string): string {
  let prefix = '';
  let body = token;
  if (body.startsWith('!')) { prefix = '!'; body = body.slice(1); }
  else if (body.startsWith('*.')) { prefix = '*.'; body = body.slice(2); }
  if (body.includes('*')) throw new Error(`rule ${token}: a wildcard only as the whole leftmost label`);
  const c = canonicalHost(body);
  if (!c) throw new Error(`rule ${token}: no valid name after Punycode conversion`);
  if (prefix === '!' && !c.includes('.')) throw new Error(`rule ${token}: an exception needs at least two labels`);
  return prefix + c;
}

/**
 * The rules of public_suffix_list.dat, validated: each line is read up to its
 * first whitespace (a trailing comment is allowed), `//` lines are comments,
 * every rule sits inside the ICANN or the PRIVATE section, each section marker
 * appears exactly once and in order, and every exception has its wildcard.
 * Throws on anything else, so an incomplete download is never taken.
 */
export function parsePublicSuffixList(text: string): ParsedList {
  // the four markers, each exactly once, as a whole comment line, in this order (Codex, review of 58d270e)
  let next = 0;
  let section: 'icann' | 'private' | null = null;
  const out: ParsedList = { icann: [], private: [] };
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const marker = MARKERS.findIndex(m => trimmed === `// ${m}`);
    if (marker >= 0) {
      if (marker !== next) throw new Error(`line ${i + 1}: marker ${MARKERS[marker]} out of order or repeated`);
      next++;
      section = marker === 0 ? 'icann' : marker === 2 ? 'private' : null;
      return;
    }
    if (MARKERS.some(m => line.includes(m))) throw new Error(`line ${i + 1}: a section marker that is not a line of its own`);
    const token = trimmed.split(/\s+/)[0] ?? '';
    if (token === '' || token.startsWith('//')) return;
    if (section === null) throw new Error(`line ${i + 1}: rule ${token} outside the ICANN and PRIVATE sections`);
    out[section].push(canonicalRule(token));
  });
  if (next !== MARKERS.length) throw new Error(`marker ${MARKERS[next]} missing`);
  const wildcards = new Set([...out.icann, ...out.private].filter(r => r.startsWith('*.')).map(r => r.slice(2)));
  for (const r of [...out.icann, ...out.private]) {
    if (r.startsWith('!') && !wildcards.has(r.slice(1).split('.').slice(1).join('.'))) {
      throw new Error(`exception ${r} without a matching wildcard rule`);
    }
  }
  return out;
}

export interface SuffixMatch {
  suffix: string; // the public suffix of the host
  listed: boolean; // false when only the default rule `*` applied
}

export interface PublicSuffixRules {
  /** The public suffix of a canonical host (full semantics, default rule included). */
  match(host: string): SuffixMatch;
  /** The registrable domain (public suffix plus one label) of a canonical host, or null. */
  getDomain(host: string): string | null;
}

export function createPublicSuffixRules(rules: string[]): PublicSuffixRules {
  const names = new Set<string>();
  const wildcards = new Set<string>(); // the part right of `*.`
  const exceptions = new Set<string>(); // the part right of `!`
  for (const r of rules) {
    if (r.startsWith('!')) exceptions.add(r.slice(1));
    else if (r.startsWith('*.')) wildcards.add(r.slice(2));
    else names.add(r);
  }
  const match = (host: string): SuffixMatch => {
    const labels = host.split('.');
    const n = labels.length;
    let best = 0; // labels of the longest matching rule
    for (let i = 0; i < n; i++) {
      const s = labels.slice(i).join('.');
      if (exceptions.has(s)) return { suffix: labels.slice(i + 1).join('.'), listed: true };
      if (names.has(s)) best = Math.max(best, n - i);
      if (i + 1 < n && wildcards.has(labels.slice(i + 1).join('.'))) best = Math.max(best, n - i);
    }
    if (best === 0) return { suffix: labels[n - 1], listed: false };
    return { suffix: labels.slice(n - best).join('.'), listed: true };
  };
  return {
    match,
    getDomain(host: string): string | null {
      const { suffix } = match(host);
      if (host === suffix) return null;
      const labels = host.split('.');
      return labels.slice(labels.length - suffix.split('.').length - 1).join('.');
    },
  };
}

/**
 * The official test corpus (tests/test_psl.txt): every
 * `checkPublicSuffix(input, expected)` line against the rules. Input and
 * expected value are compared in Punycode; null input and an input that is
 * no canonical host expect null. Returns the failing cases.
 */
export function runPublicSuffixCorpus(text: string, psl: PublicSuffixRules): { cases: number; failures: string[] } {
  const re = /^checkPublicSuffix\((null|'[^']*'),\s*(null|'[^']*')\);/;
  let cases = 0;
  const failures: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (!m) continue;
    cases++;
    const input = m[1] === 'null' ? null : m[1].slice(1, -1);
    const expected = m[2] === 'null' ? null : canonicalHost(m[2].slice(1, -1));
    const host = canonicalHost(input);
    const got = host ? psl.getDomain(host) : null;
    if (got !== expected) failures.push(`${line.trim()} -> ${got}`);
  }
  return { cases, failures };
}
