import { describe, it, expect } from 'vitest';
import { checkAnswers } from './answers';
import { checkTrust } from './trust';
import { seoPage, schema, words, html } from '../__fixtures__/pages';

describe('check 6: answer friendliness (heuristic)', () => {
  const good = html(`<main><h2>Was kostet ein Audit?</h2><p>${words(25)}</p><ul><li>a</li><li>b</li><li>c</li></ul><h2>FAQ</h2></main>`);
  const bad = html(`<main><h2>Leistungen</h2><p>${words(900)}</p></main>`);
  it('pass: question headings with answer paragraphs, a list, an FAQ', () => {
    const o = checkAnswers([{ url: 'https://example.com/a', html: good, wordCount: 400 }]);
    expect(o.result.status).toBe('pass');
    expect(o.result.heuristic).toBe(true);
    expect(o.faqPages).toEqual(['https://example.com/a']);
  });
  it('fail: long pages without questions, lists or tables; every title says "Heuristik"', () => {
    const o = checkAnswers([{ url: 'https://example.com/b', html: bad, wordCount: 900 }]);
    expect(o.result.status).toBe('fail');
    expect(o.findings.length).toBeGreaterThan(0);
    for (const f of o.findings) {
      expect(f.title_de).toMatch(/^Heuristik:/);
      expect(f.title_en).toMatch(/^Heuristic:/);
      expect(['recommended', 'optional']).toContain(f.priority);
    }
  });
  it('a hidden list and hidden details do not turn a failing page into a pass (Prüfer-210)', () => {
    const before = checkAnswers([{ url: 'https://example.com/b', html: bad, wordCount: 900 }]);
    const hidden = html(`<main><h2>Leistungen</h2><p>${words(900)}</p><section hidden><ul><li>a</li><li>b</li><li>c</li></ul>
      <details><summary>F1</summary>A1</details><details><summary>F2</summary>A2</details></section></main>`);
    const o = checkAnswers([{ url: 'https://example.com/b', html: hidden, wordCount: 900 }]);
    expect(o.result.status).toBe('fail');
    expect(o.findings.length).toBe(before.findings.length);
    expect(o.faqPages).toEqual([]);
  });
  it('not checkable: only thin pages or legal pages', () => {
    expect(checkAnswers([{ url: 'https://example.com/', html: bad, wordCount: 120 }]).result.status).toBe('not-checkable');
    expect(checkAnswers([{ url: 'https://example.com/impressum', html: bad, wordCount: 900 }]).result.status).toBe('not-checkable');
  });
});

describe('check 7: trust and freshness', () => {
  const footer = '<footer><a href="/kontakt">Kontakt</a> <a href="/impressum">Impressum</a></footer>';
  const article = (visible: boolean) => html(`<main>${visible ? '<p>von Tobias Beckmann, 6. November 2026</p>' : ''}<p>${words(600)}</p></main>${footer}`);
  const home = html(`<main><p>${words(50)}</p></main>${footer}`);
  const homePage = { url: 'https://example.com/', html: home, seo: seoPage({ url: 'https://example.com/', wordCount: 100 }) };

  it('pass: visible author and date, contact and Impressum linked, consistent dates', () => {
    const o = checkTrust({
      pages: [homePage, { url: 'https://example.com/blog/a', html: article(true), seo: seoPage({ url: 'https://example.com/blog/a' }) }],
      sitemap: { urls: [{ url: 'https://example.com/blog/a', lastmod: '2026-11-01', imageCount: 0 }], isIndex: false, subSitemaps: [] },
      modules: ['ai', 'content', 'legal'], imprintFound: true,
    });
    expect(o.result.status).toBe('pass');
    expect(o.findings).toHaveLength(0);
  });

  it('only schema author and date, nothing visible: an ai finding each, no content finding owns them', () => {
    const blog = { url: 'https://example.com/blog/a', html: article(false), seo: seoPage({ url: 'https://example.com/blog/a', hasAuthorSignal: true, hasDateSignal: true, schemas: [schema('Article', { author: { name: 'T' }, datePublished: '2026-11-06' })] }) };
    const o = checkTrust({ pages: [homePage, blog], modules: ['ai', 'content'], imprintFound: true });
    expect(o.findings.map(f => f.title_en)).toEqual(expect.arrayContaining([expect.stringMatching(/No visible author/), expect.stringMatching(/No visible date/)]));
    expect(o.result.shadow).toHaveLength(0);
  });

  it('no author or date signal at all with content active: content owns them, ai keeps a shadow entry only', () => {
    const blog = { url: 'https://example.com/blog/a', html: article(false), seo: seoPage({ url: 'https://example.com/blog/a', hasAuthorSignal: false, hasDateSignal: false }) };
    const o = checkTrust({ pages: [homePage, blog], modules: ['ai', 'content'], imprintFound: true });
    expect(o.findings.filter(f => /visible (author|date)/.test(f.title_en))).toHaveLength(0);
    expect(o.result.shadow.map(s => s.signal).sort()).toEqual(['author-any', 'date-any']);
    expect(o.result.status).toBe('fail');
  });

  it('without content active, ai reports pages with no signal at all itself', () => {
    const blog = { url: 'https://example.com/blog/a', html: article(false), seo: seoPage({ url: 'https://example.com/blog/a', hasAuthorSignal: false, hasDateSignal: false }) };
    const o = checkTrust({ pages: [homePage, blog], modules: ['ai'], imprintFound: true });
    expect(o.findings.filter(f => /visible (author|date)/.test(f.title_en))).toHaveLength(2);
  });

  it('Impressum present but not linked: an ai finding; missing altogether with legal active: legal owns it', () => {
    const noLinks = { ...homePage, html: html(`<main><p>${words(50)}</p></main><footer><a href="/kontakt">Kontakt</a></footer>`) };
    const present = checkTrust({ pages: [noLinks], modules: ['ai', 'legal'], imprintFound: true });
    expect(present.findings.map(f => f.title_en)).toContain('Legal notice (Impressum) not linked from the start page');
    const missing = checkTrust({ pages: [noLinks], modules: ['ai', 'legal'], imprintFound: false });
    expect(missing.findings.map(f => f.title_en)).not.toContain('Legal notice (Impressum) not linked from the start page');
    expect(missing.result.shadow).toEqual([{ signal: 'imprint-missing', owner: 'legal', priority: 'critical' }]);
  });

  it('sitemap: identical lastmod, dateModified far from lastmod, Last-Modified far from lastmod', () => {
    const urls = ['a', 'b', 'c', 'd', 'e'].map(x => ({ url: `https://example.com/${x}`, lastmod: '2026-10-21', imageCount: 0 }));
    const p = { url: 'https://example.com/a', html: home, seo: seoPage({ url: 'https://example.com/a', wordCount: 100, schemas: [schema('WebPage', { dateModified: '2026-06-01' })] }), lastModified: 'Mon, 01 Jun 2026 10:00:00 GMT' };
    const o = checkTrust({ pages: [homePage, p], sitemap: { urls, isIndex: false, subSitemaps: [] }, modules: ['ai'], imprintFound: true });
    const t = o.findings.map(f => f.title_en);
    expect(t).toEqual(expect.arrayContaining([
      expect.stringMatching(/All 5 sitemap entries share one lastmod/),
      expect.stringMatching(/dateModified and sitemap lastmod differ/),
      expect.stringMatching(/Sitemap lastmod is more than 30 days newer than Last-Modified/),
    ]));
  });

  // websites-33: the direction counts
  describe('Last-Modified against lastmod', () => {
    const urls = ['a', 'b'].map(x => ({ url: `https://example.com/${x}`, lastmod: '2026-10-21', imageCount: 0 }));
    const page = (lastModified?: string) => ({ url: 'https://example.com/a', html: home, seo: seoPage({ url: 'https://example.com/a', wordCount: 100 }), lastModified });
    const run = (lastModified?: string) => checkTrust({ pages: [homePage, page(lastModified)], sitemap: { urls, isIndex: false, subSitemaps: [] }, modules: ['ai'], imprintFound: true });
    const headerTitles = (o: ReturnType<typeof run>) => o.findings.map(f => f.title_en).filter(t => /Last-Modified/.test(t));

    it('lastmod newer than Last-Modified: the finding stays', () => {
      const o = run('Mon, 01 Jun 2026 10:00:00 GMT');
      expect(headerTitles(o)).toEqual(['Sitemap lastmod is more than 30 days newer than Last-Modified on 1 page(s)']);
      expect(o.result.details_en.join(' ')).not.toMatch(/no points deducted/);
    });

    it('Last-Modified newer than lastmod (every upload stamps all files): a note only, no finding', () => {
      const o = run('Sat, 26 Dec 2026 10:00:00 GMT');
      expect(headerTitles(o)).toEqual([]);
      expect(o.result.details_en.join(' ')).toMatch(/Note, no points deducted: Last-Modified is more than 30 days newer than lastmod on 1 page\(s\)/);
      expect(o.result.details_de.join(' ')).toMatch(/Hinweis ohne Punktabzug/);
      expect(JSON.stringify(o.result)).not.toMatch(/[\u2013\u2014]/);
    });

    it('without Last-Modified: no finding, named as not checkable', () => {
      const o = run(undefined);
      expect(headerTitles(o)).toEqual([]);
      expect(o.result.details_en.join(' ')).toMatch(/No Last-Modified header: this comparison not checkable/);
    });

    it('a newer Last-Modified costs no points: same score as no header at all', () => {
      expect(run('Sat, 26 Dec 2026 10:00:00 GMT').findings.length).toBe(run(undefined).findings.length);
    });
  });

  it('not checkable: no page; without sitemap and headers those parts are named as not checkable', () => {
    expect(checkTrust({ pages: [], modules: ['ai'], imprintFound: true }).result.status).toBe('not-checkable');
    const o = checkTrust({ pages: [homePage], modules: ['ai'], imprintFound: true });
    expect(o.result.details_en.join(' ')).toMatch(/No sitemap with entries/);
  });
});
