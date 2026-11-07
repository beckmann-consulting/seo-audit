import { describe, it, expect } from 'vitest';
import { checkCrawlers } from './crawlers';
import { checkSnippets } from './snippets';
import { checkLlms } from './llms';
import { AI_CRAWLERS } from '../crawlers';

const ok = (content: string) => ({ status: 'ok' as const, httpStatus: 200, content });

describe('check 1: AI crawlers in robots.txt', () => {
  it('pass: everything allowed; the finding text would name Google-Extended and Googlebot', () => {
    const o = checkCrawlers(ok('User-agent: *\nAllow: /\n'), AI_CRAWLERS);
    expect(o.result.status).toBe('pass');
    expect(o.findings).toHaveLength(0);
    expect(o.result.details_de.join(' ')).toMatch(/Google-Extended.*Googlebot/);
    expect(o.result.details_de.join(' ')).toMatch(/Kein KI-Bot ist ausdrücklich genannt/);
  });
  it('fail, critical: every documented search bot blocked', () => {
    const o = checkCrawlers(ok('User-agent: *\nDisallow: /\n'), AI_CRAWLERS);
    expect(o.result.status).toBe('fail');
    expect(o.findings).toHaveLength(1);
    expect(o.findings[0].priority).toBe('critical');
    expect(o.findings[0].module).toBe('ai');
    expect(o.findings[0].description_en).toMatch(/Google-Extended.*Googlebot/);
  });
  it('"User-agent: *" with "Disallow: /" is seo\'s finding when seo is active: ai keeps a shadow entry only', () => {
    const o = checkCrawlers(ok('User-agent: *\nDisallow: /\n'), AI_CRAWLERS, ['seo', 'ai']);
    expect(o.findings).toHaveLength(0);
    expect(o.result.status).toBe('fail');
    expect(o.result.shadow).toEqual([{ signal: 'robots-wildcard', owner: 'seo', priority: 'critical' }]);
    // a bot blocked through a group of its own is still ai's
    const own = checkCrawlers(ok('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /\n'), AI_CRAWLERS, ['seo', 'ai']);
    expect(own.findings).toHaveLength(1);
    expect(own.findings[0].description_en).toMatch(/OAI-SearchBot/);
  });
  it('fail, important: only some search bots blocked', () => {
    const o = checkCrawlers(ok('User-agent: OAI-SearchBot\nDisallow: /\n'), AI_CRAWLERS);
    expect(o.findings[0].priority).toBe('important');
    expect(o.findings[0].title_en).toMatch(/1 of/);
  });
  it('only user fetchers blocked: no finding, shown with the caveat', () => {
    const o = checkCrawlers(ok('User-agent: ChatGPT-User\nDisallow: /\n\nUser-agent: Perplexity-User\nDisallow: /\n'), AI_CRAWLERS);
    expect(o.result.status).toBe('pass');
    expect(o.findings).toHaveLength(0);
    expect(o.result.details_en.join(' ')).toMatch(/User fetchers blocked: ChatGPT-User, Perplexity-User/);
  });
  it('training bots blocked: no finding', () => {
    const o = checkCrawlers(ok('User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n'), AI_CRAWLERS);
    expect(o.result.status).toBe('pass');
    expect(o.findings).toHaveLength(0);
  });
  it('Disallow: / with Allow exceptions is partial, not a block', () => {
    const o = checkCrawlers(ok('User-agent: OAI-SearchBot\nDisallow: /\nAllow: /blog\n'), AI_CRAWLERS);
    expect(o.findings).toHaveLength(0);
    expect(o.bots.find(b => b.token === 'OAI-SearchBot')?.status).toBe('partial');
  });
  it('404: everything allowed (pass with note); 5xx and network errors: not checkable', () => {
    expect(checkCrawlers({ status: 'not-found', httpStatus: 404 }, AI_CRAWLERS).result.status).toBe('pass');
    const e5 = checkCrawlers({ status: 'server-error', httpStatus: 503 }, AI_CRAWLERS);
    expect(e5.result.status).toBe('not-checkable');
    expect(e5.result.summary_de).toMatch(/RFC 9309/);
    expect(checkCrawlers({ status: 'network-error', error: 'ECONNRESET' }, AI_CRAWLERS).result.status).toBe('not-checkable');
  });
});

describe('check 2: snippet controls', () => {
  const page = (head: string, body = '<main><p>Text der Seite mit genug Inhalt für einen Test hier.</p></main>', xRobotsTag?: string) =>
    ({ url: 'https://example.com/', html: `<html><head>${head}</head><body>${body}</body></html>`, xRobotsTag });
  it('pass: no restricting directive', () => {
    expect(checkSnippets([page('<meta name="robots" content="max-snippet:-1">')]).result.status).toBe('pass');
  });
  it('fail: nosnippet (important), small max-snippet (optional heuristic), data-nosnippet over the main text (recommended)', () => {
    const o = checkSnippets([
      page('<meta name="robots" content="nosnippet">'),
      { ...page('<meta name="robots" content="max-snippet:20">'), url: 'https://example.com/a' },
      { ...page('', '<main><div data-nosnippet><p>Ganz viel geheimer Text der nicht zitiert werden soll hier.</p></div></main>'), url: 'https://example.com/b' },
    ]);
    expect(o.result.status).toBe('fail');
    expect(o.findings.map(f => f.priority).sort()).toEqual(['important', 'optional', 'recommended']);
    expect(o.findings.find(f => f.priority === 'optional')?.title_de).toMatch(/^Heuristik:/);
  });
  it('fail via the X-Robots-Tag header for googlebot', () => {
    const o = checkSnippets([page('', undefined, 'googlebot: nosnippet')]);
    expect(o.findings[0].description_en).toMatch(/X-Robots-Tag googlebot/);
  });
  it('not checkable: no page with HTML', () => {
    expect(checkSnippets([{ url: 'https://example.com/', html: '' }]).result.status).toBe('not-checkable');
  });
});

describe('check 3: llms.txt, a note in every state', () => {
  for (const status of ['present-readable', 'present-unreadable', 'absent', 'error'] as const) {
    it(`${status}: info, no finding`, () => {
      const o = checkLlms({ status, url: 'https://example.com/llms.txt' });
      expect(o.result.status).toBe('info');
      expect(o.findings).toHaveLength(0);
    });
  }
});
