// Configurable User-Agent presets.
//
// Two pieces of information per preset:
// 1. The HTTP `User-Agent` header string the crawler sends. We use the
//    actual UA strings the real bots emit so origin servers serving
//    different content per UA (e.g. cloaking detection in security
//    auditing, dedicated mobile-first SSR variants) hand back the
//    same response a real Googlebot/Bingbot/GPTBot would receive.
// 2. The robots.txt token the bot identifies itself as. Picking the
//    right group from /robots.txt depends on this — Google's spec
//    says a bot uses the *most specific* matching group, so when we
//    audit "as Googlebot" we should respect a Googlebot-specific
//    Disallow rather than the generic '*' rule.

import type { UserAgentPreset } from '@/types';

export type { UserAgentPreset };

const PRESET_USER_AGENTS: Record<Exclude<UserAgentPreset, 'custom'>, string> = {
  default:
    'Mozilla/5.0 (compatible; SEOAuditPro/2.0; +https://beckmanndigital.com)',
  'googlebot-mobile':
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/W.X.Y.Z Mobile Safari/537.36 ' +
    '(compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'googlebot-desktop':
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; ' +
    '+http://www.google.com/bot.html) Chrome/W.X.Y.Z Safari/537.36',
  bingbot:
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  gptbot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; ' +
    '+https://openai.com/gptbot)',
  claudebot:
    'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  perplexitybot:
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; ' +
    '+https://perplexity.ai/perplexitybot.html)',
};

// The token a robots.txt `User-agent:` line should match for this bot.
// Empty string means "no specific token; matches only the wildcard * group".
const ROBOTS_TOKENS: Record<UserAgentPreset, string> = {
  default: '',
  'googlebot-mobile': 'googlebot',
  'googlebot-desktop': 'googlebot',
  bingbot: 'bingbot',
  gptbot: 'gptbot',
  claudebot: 'claudebot',
  perplexitybot: 'perplexitybot',
  custom: '',
};

export interface UserAgentSelection {
  userAgent?: UserAgentPreset;
  customUserAgent?: string;
}

// Resolves an AuditConfig-shaped object to the actual UA string we send.
// Falls back to `default` when:
//   - no preset is given
//   - preset is `custom` but customUserAgent is empty / whitespace
export function resolveUserAgent(selection: UserAgentSelection | undefined): string {
  if (!selection) return PRESET_USER_AGENTS.default;
  const preset = selection.userAgent ?? 'default';
  if (preset === 'custom') {
    const trimmed = (selection.customUserAgent ?? '').trim();
    return trimmed.length > 0 ? trimmed : PRESET_USER_AGENTS.default;
  }
  return PRESET_USER_AGENTS[preset];
}

// Robots.txt token to use for "most specific group" matching. When the
// audit runs as the default UA (or a custom UA we can't match), we
// return '' which callers should treat as "wildcard '*' only".
export function getRobotsToken(selection: UserAgentSelection | undefined): string {
  if (!selection) return '';
  const preset = selection.userAgent ?? 'default';
  return ROBOTS_TOKENS[preset];
}
