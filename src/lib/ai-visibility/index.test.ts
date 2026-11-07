// The module as the route calls it, without Browserless: static pages, a
// stubbed local render (complete for one page, incomplete for another), and
// the sitemap gate for an audit with ai alone.

import { describe, it, expect } from 'vitest';
import { evaluateAIVisibility, needsSitemap } from './index';
import { seoPage, words, html } from './__fixtures__/pages';
import type { PageData } from '@/types';

const raw = (url: string, h: string): PageData => ({ url, html: h, statusCode: 200, depth: 0, redirectChain: [], finalUrl: url, httpStatus: 200, protocol: null, renderMode: 'static' });
const staticHtml = html(`<main><h1>Start</h1><p>${words(40)}</p></main><footer><a href="/kontakt">Kontakt</a><a href="/impressum">Impressum</a></footer>`);
const renderedMore = html(`<main><h1>Start</h1><h2>Nur gerendert</h2><p>${words(400)}</p></main>`);

describe('evaluateAIVisibility without Browserless', () => {
  const pages = [seoPage({ url: 'https://example.com/', wordCount: 40 }), seoPage({ url: 'https://example.com/b', wordCount: 40 })];
  const rawPages = [raw('https://example.com/', staticHtml), raw('https://example.com/b', staticHtml)];
  const base = { pages, rawPages, robots: { status: 'ok' as const, httpStatus: 200, content: 'User-agent: *\nAllow: /\n' }, llms: { status: 'absent' as const, url: 'https://example.com/llms.txt' }, modules: ['ai' as const], imprintFound: true };

  it('a complete local render is assessed; an incomplete one is only noted', () => {
    const localRender = new Map([
      ['https://example.com/', { renderedHtml: renderedMore }],
      ['https://example.com/b', { renderedHtml: renderedMore, incompleteReason: 'request to another host blocked (cdn.test)' }],
    ]);
    const { info, findings } = evaluateAIVisibility({ ...base, localRender });
    const nojs = info.checks.find(c => c.id === 'nojs');
    expect(nojs?.status).toBe('fail');
    expect(info.render.source).toBe('local');
    expect(info.render.pages.map(p => p.state)).toEqual(['assessed', 'incomplete']);
    expect(findings.filter(f => /only present after JavaScript/.test(f.title_en))).toHaveLength(1);
    expect(findings.find(f => /only present after JavaScript/.test(f.title_en))?.description_en).not.toContain('https://example.com/b');
  });

  it('without any render, check 5 is not checkable and the module still has a score from the others', () => {
    const { info } = evaluateAIVisibility(base);
    expect(info.checks.find(c => c.id === 'nojs')?.status).toBe('not-checkable');
    expect(info.coverage.assessable).toBeGreaterThan(0);
    expect(info.score).toBeDefined();
    expect(info.checks.find(c => c.id === 'llms')?.status).toBe('info');
  });
});

describe('needsSitemap', () => {
  it('ai alone loads the sitemap too', () => {
    expect(needsSitemap(['ai'])).toBe(true);
    expect(needsSitemap(['seo'])).toBe(true);
    expect(needsSitemap(['content', 'tech'])).toBe(false);
  });
});
