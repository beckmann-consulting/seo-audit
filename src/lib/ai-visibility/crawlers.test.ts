import { describe, it, expect } from 'vitest';
import { AI_CRAWLERS, isScoreRelevant } from './crawlers';

describe('crawlers.json', () => {
  it('every entry has token, vendor, purpose, robotsTxt, sourceStatus and an ISO date', () => {
    for (const c of AI_CRAWLERS) {
      expect(c.token, JSON.stringify(c)).toMatch(/^[A-Za-z][A-Za-z0-9-]*$/);
      expect(c.vendor.length).toBeGreaterThan(0);
      expect(['training', 'search', 'user', 'mixed', 'unknown']).toContain(c.purpose);
      expect(['honored', 'may-ignore', 'ignored', 'unknown']).toContain(c.robotsTxt);
      expect(c.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.controls_de.length).toBeGreaterThan(0);
      expect(c.controls_en.length).toBeGreaterThan(0);
    }
  });

  it('official entries have an https source; none-found entries have null', () => {
    for (const c of AI_CRAWLERS) {
      if (c.sourceStatus === 'official') expect(c.source, c.token).toMatch(/^https:\/\//);
      else expect(c.source, c.token).toBeNull();
    }
  });

  it('names every token of the order, without duplicates', () => {
    const tokens = AI_CRAWLERS.map(c => c.token.toLowerCase());
    for (const t of ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Bytespider']) {
      expect(tokens, t).toContain(t.toLowerCase());
    }
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('only documented search bots that honour robots.txt count for the score', () => {
    const relevant = AI_CRAWLERS.filter(isScoreRelevant).map(c => c.token);
    expect(relevant).toContain('OAI-SearchBot');
    expect(relevant).toContain('PerplexityBot');
    expect(relevant).toContain('Claude-SearchBot');
    for (const t of ['ChatGPT-User', 'Perplexity-User', 'GPTBot', 'Bytespider', 'anthropic-ai', 'CCBot']) expect(relevant).not.toContain(t);
    for (const c of AI_CRAWLERS.filter(isScoreRelevant)) expect(c.sourceStatus).toBe('official');
  });
});
