// Parser for the X-Robots-Tag HTTP response header.
//
// Spec reference: https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#xrobotstag
//
// Header forms in the wild:
//   X-Robots-Tag: noindex
//   X-Robots-Tag: noindex, nofollow
//   X-Robots-Tag: googlebot: noindex, nofollow
//   X-Robots-Tag: googlebot: noindex
//   X-Robots-Tag: otherbot: noindex
//   X-Robots-Tag: max-snippet: 50, noindex
//   X-Robots-Tag: unavailable_after: 25 Jun 2010 15:00:00 PST
//
// When a server emits multiple X-Robots-Tag headers, Node's
// Headers.get() joins them with ", " — that's why we split on
// commas and track the "current bot" prefix sticky across tokens.

const DIRECTIVE_KEYS_WITH_VALUE = new Set([
  'max-snippet',
  'max-image-preview',
  'max-video-preview',
  'unavailable_after',
]);

// Bots whose `noindex` we treat as an indexability signal.
// Googlebot is the obvious one; we include the major variants
// because a site that noindexes for Googlebot but not '*' has
// effectively excluded itself from Google search.
const NOINDEX_RELEVANT_BOTS = new Set([
  'googlebot',
  'googlebot-news',
  'googlebot-image',
  'googlebot-video',
]);

export interface ParsedXRobots {
  raw: string;
  // Directives that apply with no bot prefix (i.e. effectively all bots).
  generalDirectives: string[];
  // Bot-specific directives. Bot names are lowercased.
  botSpecific: { bot: string; directives: string[] }[];
}

export function parseXRobotsTag(raw: string | undefined): ParsedXRobots | null {
  if (!raw) return null;
  const tokens = raw.split(',').map(t => t.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const general: string[] = [];
  const byBot = new Map<string, string[]>();
  let currentBot: string | null = null;

  const push = (directive: string) => {
    const norm = directive.toLowerCase().trim();
    if (!norm) return;
    if (currentBot === null || currentBot === '*') {
      general.push(norm);
    } else {
      const list = byBot.get(currentBot) ?? [];
      list.push(norm);
      byBot.set(currentBot, list);
    }
  };

  for (const token of tokens) {
    const colonIdx = token.indexOf(':');
    if (colonIdx === -1) {
      push(token);
      continue;
    }
    const before = token.slice(0, colonIdx).trim().toLowerCase();
    const after = token.slice(colonIdx + 1).trim();

    if (DIRECTIVE_KEYS_WITH_VALUE.has(before)) {
      // Whole token is one keyed directive (e.g. "max-snippet: 50").
      push(token);
    } else if (before && /^[a-z][a-z0-9-]*$/.test(before)) {
      // Looks like a bot name. Switch context, then push the post-colon part.
      currentBot = before;
      if (after) push(after);
    } else {
      // Unrecognised shape — keep it as a raw directive on the current bot.
      push(token);
    }
  }

  return {
    raw,
    generalDirectives: general,
    botSpecific: [...byBot.entries()].map(([bot, directives]) => ({ bot, directives })),
  };
}

// True when the parsed header signals that THIS page should not be
// indexed — either generically or specifically for Googlebot.
// `none` is equivalent to `noindex, nofollow` per the spec.
export function xRobotsImpliesNoindex(parsed: ParsedXRobots | null): boolean {
  if (!parsed) return false;
  const hasNoindexLike = (directives: string[]) =>
    directives.some(d => d === 'noindex' || d === 'none');

  if (hasNoindexLike(parsed.generalDirectives)) return true;
  for (const entry of parsed.botSpecific) {
    if (NOINDEX_RELEVANT_BOTS.has(entry.bot) && hasNoindexLike(entry.directives)) {
      return true;
    }
  }
  return false;
}
