// The Public Suffix List of the repo (public-suffix-list.json, refreshed by
// hand with scripts/update-public-suffix-list.mjs) behind the algorithm of
// public-suffix-core.ts, loaded once on first use (ultimate-40b).

import { isIP } from 'node:net';
import data from './public-suffix-list.json';
import { canonicalHost, createPublicSuffixRules, type PublicSuffixRules } from './public-suffix-core';

export { canonicalHost } from './public-suffix-core';

let rules: PublicSuffixRules | undefined;
function psl(): PublicSuffixRules {
  if (!rules) rules = createPublicSuffixRules((data as { rules: string[] }).rules);
  return rules;
}

/** True when the domain is itself a public suffix (full semantics: wildcards, exceptions, default rule). */
export function isPublicSuffix(domain: string): boolean {
  const d = canonicalHost(domain);
  return d !== null && psl().match(d).suffix === d;
}

/**
 * The registrable domain of a host for the scope of the local render: only
 * when a listed rule applies; null for an IP address, an invalid host, a
 * public suffix itself, or a host only the default rule `*` covers (then the
 * old rule of host and www or apex counterpart holds).
 */
export function registrableDomain(host: string): string | null {
  const h = canonicalHost(host);
  if (!h || isIP(h)) return null;
  const m = psl().match(h);
  if (!m.listed) return null;
  return psl().getDomain(h);
}

/** The official registrable domain (default rule included), as the test corpus defines it. */
export function getDomain(host: string): string | null {
  const h = canonicalHost(host);
  return h ? psl().getDomain(h) : null;
}
