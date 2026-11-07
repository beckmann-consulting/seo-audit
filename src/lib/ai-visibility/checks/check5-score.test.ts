import { describe, it, expect } from 'vitest';
import { checkNoJs } from './nojs';
import { aiCoverage, aiModuleScore, weightedTotal } from '../score';
import { getTopFindings } from '@/lib/findings/utils';
import { seoPage, words, html } from '../__fixtures__/pages';
import type { AICheckResult } from '../types';
import type { Finding, ModuleScore } from '@/types';

const head = (canonical = '/de/') => `<title>Seite</title><link rel="canonical" href="${canonical}">`;
const full = html(`<main><h1>Titel</h1><h2>Teil</h2><p>${words(200)}</p></main>`, head());
const shell = html('<div id="root"></div>', head());

describe('check 5: readable without JavaScript', () => {
  it('pass: static HTML has the main text, headings and head of the rendered DOM', () => {
    const o = checkNoJs([{ url: 'https://example.com/de/', staticHtml: full, renderedHtml: full, source: 'browserless', seo: seoPage() }], ['ai']);
    expect(o.result.status).toBe('pass');
    expect(o.render.pages[0]).toMatchObject({ state: 'assessed', missingHeadings: [], headDiffs: [] });
  });

  it('fail: main text and headings only rendered, and the head differs', () => {
    const rendered = html(`<main><h1>Titel</h1><h2>Teil</h2><p>${words(200)}</p></main>`, head('/de/neu'));
    const o = checkNoJs([{ url: 'https://example.com/de/', staticHtml: html('<main><p>kurz</p></main>', head()), renderedHtml: rendered, source: 'browserless', seo: seoPage() }], ['ai']);
    expect(o.result.status).toBe('fail');
    const t = o.findings.map(f => f.title_en);
    expect(t).toEqual(expect.arrayContaining([expect.stringMatching(/^Main text or headings only present after JavaScript/), expect.stringMatching(/^Head changes after JavaScript/)]));
  });

  it('50 to 79 % of the main text statically, or an H3 only rendered: a lower failure (Codex, review of bcfe8de, F-005)', () => {
    const rendered = html(`<main><h1>Titel</h1><h2>Teil</h2><p>${words(200)}</p></main>`, head());
    const partly = html(`<main><h1>Titel</h1><h2>Teil</h2><p>${words(130)}</p></main>`, head()); // 65 %
    const o = checkNoJs([{ url: 'https://example.com/de/', staticHtml: partly, renderedHtml: rendered, source: 'browserless', seo: seoPage() }], ['ai']);
    expect(o.result.status).toBe('fail');
    expect(o.findings.map(f => [f.priority, f.title_en.split(':')[0]])).toEqual([['recommended', 'Parts of the content only present after JavaScript']]);
    const withH3 = html(`<main><h1>Titel</h1><h2>Teil</h2><h3>Nur gerendert</h3><p>${words(200)}</p></main>`, head());
    const h3 = checkNoJs([{ url: 'https://example.com/de/', staticHtml: full, renderedHtml: withH3, source: 'browserless', seo: seoPage() }], ['ai']);
    expect(h3.result.status).toBe('fail');
    expect(h3.findings[0].priority).toBe('recommended');
    expect(h3.render.pages[0].missingHeadings).toEqual(['h3: Nur gerendert']);
  });

  it('with tech active, a page tech flags for its word count is tech\'s: only a shadow entry for the main text', () => {
    const seo = seoPage({ renderMode: 'js', staticWordCount: 5, wordCount: 300 });
    const staticHtml = html('<main><h1>Titel</h1><h2>Teil</h2><p>kurz</p></main>', head());
    const o = checkNoJs([{ url: 'https://example.com/de/', staticHtml, renderedHtml: full, source: 'browserless', seo }], ['ai', 'tech']);
    expect(o.findings).toHaveLength(0);
    expect(o.result.shadow.map(s => s.signal)).toEqual(['js-required']);
    expect(o.result.status).toBe('fail');
  });

  it('an empty shell without any render fails (tech owns it when active)', () => {
    const page = { url: 'https://example.com/', staticHtml: shell, seo: seoPage({ likelyClientRendered: true }) };
    const alone = checkNoJs([page], ['ai']);
    expect(alone.result.status).toBe('fail');
    expect(alone.findings[0].title_en).toMatch(/^Page empty without JavaScript/);
    const withTech = checkNoJs([page], ['ai', 'tech']);
    expect(withTech.findings).toHaveLength(0);
    expect(withTech.result.shadow[0].owner).toBe('tech');
  });

  it('not checkable: no render and no shell; an incomplete local render is noted, never assessed', () => {
    expect(checkNoJs([{ url: 'https://example.com/', staticHtml: full, seo: seoPage() }], ['ai']).result.status).toBe('not-checkable');
    const o = checkNoJs([{ url: 'https://example.com/', staticHtml: html('<main><p>kurz</p></main>'), renderedHtml: full, source: 'local', incompleteReason: 'foreign script blocked', seo: seoPage() }], ['ai']);
    expect(o.result.status).toBe('not-checkable');
    expect(o.findings).toHaveLength(0);
    expect(o.result.details_en.join(' ')).toMatch(/not assessed \(foreign script blocked\); partial comparison, unscored/);
    expect(o.render.pages[0].state).toBe('incomplete');
  });
});

const check = (id: AICheckResult['id'], status: AICheckResult['status'], shadow: AICheckResult['shadow'] = []): AICheckResult =>
  ({ id, status, summary_de: '', summary_en: '', details_de: [], details_en: [], shadow });
const f = (priority: Finding['priority'], module: Finding['module'] = 'ai'): Finding =>
  ({ id: `x${Math.random()}`, priority, module, effort: 'low', impact: 'low', title_de: '', title_en: '', description_de: '', description_en: '', recommendation_de: '', recommendation_en: '' });

describe('coverage, module score and total', () => {
  it('no assessable check: no score; llms.txt (info) never counts', () => {
    const checks = [check('crawlers', 'not-checkable'), check('llms', 'info'), check('nojs', 'not-checkable')];
    expect(aiCoverage(checks)).toEqual({ assessable: 0, total: 6 });
    expect(aiModuleScore(checks, [])).toBeUndefined();
  });
  it('partly not checkable: score over the assessable checks only', () => {
    const checks = [check('crawlers', 'pass'), check('nojs', 'not-checkable'), check('answers', 'fail')];
    expect(aiCoverage(checks).assessable).toBe(2);
    expect(aiModuleScore(checks, [f('recommended')])).toBe(96);
  });
  it('a failed check whose finding seo owns lowers the ai score through its shadow entry, never to 100', () => {
    const checks = [check('structured', 'fail', [{ signal: 'schema-required', owner: 'seo', priority: 'important' }])];
    expect(aiModuleScore(checks, [])).toBe(90);
  });
  it('shadow entries never reach the Top 5', () => {
    const top = getTopFindings([f('optional'), f('important', 'seo')], 5);
    expect(top.every(x => !x.id.startsWith('shadow-'))).toBe(true);
  });
  it('total: ai counts half; without ai the plain mean of before', () => {
    const ms = (module: ModuleScore['module'], score: number): ModuleScore => ({ module, score, label_de: '', label_en: '' });
    expect(weightedTotal([ms('seo', 80), ms('tech', 60)])).toBe(70);
    expect(weightedTotal([ms('seo', 80), ms('tech', 60), ms('ai', 0)])).toBe(56); // (80 + 60 + 0) / 2.5
    expect(weightedTotal([])).toBe(50);
  });
  it('ai findings rank with weight 1.2 in the Top 5', () => {
    const a = f('important');
    const c = f('important', 'content');
    expect(getTopFindings([c, a], 1)[0]).toBe(a);
  });
});
