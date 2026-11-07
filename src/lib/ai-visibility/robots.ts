// robots.txt as RFC 9309 defines it, for the AI visibility module.
//
// - A group is one or more user-agent lines followed by rules; it ends at
//   the next user-agent line after a rule. Other lines (sitemap,
//   crawl-delay, unknown keys) neither belong to a group nor end it.
// - A crawler finds its group by its product token, case-insensitively.
//   Several groups that match the same token are combined into one.
//   Without a matching group the "*" group applies; without that,
//   everything is allowed.
// - Of the rules that match a path, the one with the most octets wins;
//   on a tie between allow and disallow, allow wins (the least
//   restrictive rule). "*" matches any sequence, a trailing "$" anchors
//   the end. An empty rule matches nothing.
// - Paths and rules are compared percent-normalised: octets that encode
//   an unreserved character are decoded, every other escape keeps its
//   encoding with upper-case hex digits, and non-ASCII characters are
//   encoded. So "%62" equals "b" and "%2f" equals "%2F", but "%2F" is not
//   "/": the reserved slash stays encoded.

export interface RobotsRule {
  allow: boolean;
  pattern: string; // normalised
}

export interface RobotsGroup {
  agents: string[]; // lower-case product tokens, "*" for the wildcard
  rules: RobotsRule[];
}

export type RobotsBotStatus = 'allowed' | 'partial' | 'blocked';

export interface RobotsBotVerdict {
  status: RobotsBotStatus;
  // 'own': the bot has a group of its own; 'wildcard': it follows "*";
  // 'none': no group applies, everything is allowed.
  group: 'own' | 'wildcard' | 'none';
}

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** Percent-normalise a path or a rule pattern for comparison (RFC 9309, 2.2.2). */
export function normalizePath(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      const hex = raw.slice(i + 1, i + 3).toUpperCase();
      const decoded = String.fromCharCode(parseInt(hex, 16));
      out += UNRESERVED.test(decoded) ? decoded : `%${hex}`;
      i += 2;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code > 0x7e || code < 0x21) {
      // non-ASCII (and spaces, controls): encode the UTF-8 octets
      const cp = raw.codePointAt(i) as number;
      const s = String.fromCodePoint(cp);
      for (const b of Buffer.from(s, 'utf8')) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
      if (cp > 0xffff) i++;
      continue;
    }
    out += ch;
  }
  return out;
}

function productToken(value: string): string {
  // "GPTBot/1.1" or "GPTBot (+https://…)" name the token GPTBot
  return value.trim().split(/[\/\s]/)[0].toLowerCase();
}

/** Parse robots.txt into groups (RFC 9309, 2.1 and 2.2). */
export function parseRobots(content: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let sawRule = false;
  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!current || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      const token = productToken(value);
      if (token) current.agents.push(token);
    } else if (key === 'allow' || key === 'disallow') {
      if (!current) continue; // a rule before any user-agent line belongs to no group
      sawRule = true;
      if (value === '') continue; // an empty rule matches nothing
      current.rules.push({ allow: key === 'allow', pattern: normalizePath(value) });
    }
  }
  return groups;
}

/** The combined rules for a product token, and where they came from. */
export function groupFor(groups: RobotsGroup[], token: string): { rules: RobotsRule[]; group: RobotsBotVerdict['group'] } {
  const t = token.toLowerCase();
  const own = groups.filter(g => g.agents.includes(t));
  if (own.length > 0) return { rules: own.flatMap(g => g.rules), group: 'own' };
  const wildcard = groups.filter(g => g.agents.includes('*'));
  if (wildcard.length > 0) return { rules: wildcard.flatMap(g => g.rules), group: 'wildcard' };
  return { rules: [], group: 'none' };
}

function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const parts = body.split('*');
  // linear scan: the first part is a prefix, each next part the earliest
  // occurrence after the previous one; with "$" the last part must end the path
  if (!path.startsWith(parts[0])) return false;
  let pos = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (i === parts.length - 1 && anchored) {
      return path.length - part.length >= pos && path.endsWith(part);
    }
    const at = path.indexOf(part, pos);
    if (at < 0) return false;
    pos = at + part.length;
  }
  return anchored ? pos === path.length : true;
}

/** Whether a path is allowed under the given rules (longest match, allow wins a tie). */
export function isAllowed(rules: RobotsRule[], rawPath: string): boolean {
  const path = normalizePath(rawPath || '/');
  let best: RobotsRule | null = null;
  for (const r of rules) {
    if (!patternMatches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) {
      best = r;
    }
  }
  return !best || best.allow;
}

// ------------------------------------------------------------
//  Exact verdict: is any path allowed? (Codex, review of 18d2c8d)
// ------------------------------------------------------------
//
// A rule pattern is a regular language over path characters: "*" is any
// sequence, a trailing "$" anchors the end, and without "$" the pattern is a
// prefix (as if it ended in "*"). A path is allowed when no rule matches it,
// or when an allow rule matches it and no strictly longer disallow rule does
// (the longest match wins, allow wins a tie). So a path is allowed exactly if
// it lies in L(A) minus the union of L(D) for every disallow D longer than A,
// for some allow A or for a virtual allow of length -1 that matches every
// path. Each of these differences is searched breadth-first over the product
// of the patterns' automata; the alphabet is every literal character of the
// rules plus one character none of them names. A path found is checked
// against isAllowed once more. Where the search would pass SEARCH_LIMIT
// states, nothing is proven and the verdict stays "partial".

type Tok = { star: true } | { ch: string };

export const SEARCH_LIMIT = 20_000;

function compile(pattern: string): Tok[] {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const toks: Tok[] = [];
  for (const c of body) {
    if (c === '*') {
      if (!(toks.length > 0 && 'star' in toks[toks.length - 1])) toks.push({ star: true });
    } else toks.push({ ch: c });
  }
  if (!anchored && !(toks.length > 0 && 'star' in toks[toks.length - 1])) toks.push({ star: true });
  return toks;
}

function closure(toks: Tok[], states: Iterable<number>): number[] {
  const out = new Set<number>(states);
  const stack = [...out];
  while (stack.length > 0) {
    const s = stack.pop() as number;
    if (s < toks.length && 'star' in toks[s] && !out.has(s + 1)) {
      out.add(s + 1);
      stack.push(s + 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function step(toks: Tok[], states: number[], c: string): number[] {
  const next: number[] = [];
  for (const s of states) {
    if (s >= toks.length) continue;
    const t = toks[s];
    if ('star' in t) next.push(s);
    else if (t.ch === c) next.push(s + 1);
  }
  return closure(toks, next);
}

const accepts = (toks: Tok[], states: number[]) => states.includes(toks.length);

// accepts every continuation from here on: only stars are left after one of the states
const acceptsForever = (toks: Tok[], states: number[]) => states.some(s => s < toks.length && toks.slice(s).every(t => 'star' in t));

const OTHER_CANDIDATES = 'qzjkwvxyQZJKWVXY0123456789-._~';

/**
 * A path the rules allow, or null when provably none is; undefined when the
 * search would pass SEARCH_LIMIT states (nothing proven).
 */
export function allowedWitness(rules: RobotsRule[], limit = SEARCH_LIMIT): string | null | undefined {
  const literals = new Set<string>();
  // only a trailing "$" is the anchor; a "$" inside a pattern is a literal the search must be able to write
  for (const r of rules) {
    const body = r.pattern.endsWith('$') ? r.pattern.slice(0, -1) : r.pattern;
    for (const c of body) if (c !== '*') literals.add(c);
  }
  literals.add('/');
  const other = [...OTHER_CANDIDATES].find(c => !literals.has(c)) ?? [...Array(94)].map((_, i) => String.fromCharCode(33 + i)).find(c => !literals.has(c) && c !== '*' && c !== '$');
  const alphabet = [...literals, ...(other ? [other] : [])];
  const disallows = rules.filter(r => !r.allow).map(r => ({ len: r.pattern.length, toks: compile(r.pattern) }));
  const candidates = [{ len: -1, toks: compile('/') }, ...rules.filter(r => r.allow).map(r => ({ len: r.pattern.length, toks: compile(r.pattern) }))];
  let undecided = false;
  for (const cand of candidates) {
    const ds = disallows.filter(d => d.len > cand.len);
    // every path starts with "/"
    const c0 = step(cand.toks, closure(cand.toks, [0]), '/');
    if (c0.length === 0) continue;
    const d0 = ds.map(d => step(d.toks, closure(d.toks, [0]), '/'));
    const seen = new Set<string>();
    let frontier: { c: number[]; d: number[][]; path: string }[] = [{ c: c0, d: d0, path: '/' }];
    seen.add(JSON.stringify([c0, d0]));
    let explored = 0;
    while (frontier.length > 0) {
      const next: typeof frontier = [];
      for (const node of frontier) {
        // a longer disallow that matches every continuation: nothing below this node can be allowed
        if (node.d.some((st, i) => acceptsForever(ds[i].toks, st))) continue;
        if (accepts(cand.toks, node.c) && !node.d.some((st, i) => accepts(ds[i].toks, st))) {
          if (isAllowed(rules, node.path)) return node.path;
          undecided = true; // the search and isAllowed disagree: prove nothing
          continue;
        }
        for (const sym of alphabet) {
          const c = step(cand.toks, node.c, sym);
          if (c.length === 0) continue;
          const d = node.d.map((st, i) => step(ds[i].toks, st, sym));
          const key = JSON.stringify([c, d]);
          if (seen.has(key)) continue;
          seen.add(key);
          if (++explored > limit) { undecided = true; break; }
          next.push({ c, d, path: node.path + sym });
        }
        if (explored > limit) break;
      }
      if (explored > limit) break;
      frontier = next;
    }
  }
  return undecided ? undefined : null;
}

/**
 * What robots.txt means for one bot as a whole, by the precedence of its
 * rules (RFC 9309, 2.2.2):
 * - allowed: no rule disallows anything;
 * - blocked: provably no path is allowed ("Disallow: /*" with a shorter
 *   "Allow: /", or "Disallow: /*$", block everything);
 * - partial: some path is allowed while others are not, or "blocked" could
 *   not be proven within the search limit.
 */
// Bots without a group of their own share the "*" rules: one search per set of rules.
const VERDICTS = new Map<string, RobotsBotStatus>();

export function botVerdict(groups: RobotsGroup[], token: string): RobotsBotVerdict {
  const { rules, group } = groupFor(groups, token);
  if (!rules.some(r => !r.allow)) return { status: 'allowed', group };
  const key = rules.map(r => `${r.allow ? 'A' : 'D'}${r.pattern}`).join('\n');
  let status = VERDICTS.get(key);
  if (status === undefined) {
    status = allowedWitness(rules) === null ? 'blocked' : 'partial';
    if (VERDICTS.size > 500) VERDICTS.clear();
    VERDICTS.set(key, status);
  }
  return { status, group };
}
