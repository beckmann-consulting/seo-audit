// ultimate-41, point 13: a target keyword per page, in title, H1, description and URL.
import { describe, it, expect } from 'vitest';
import { generateTargetKeywordFindings, missingPlaces, validateTargetKeywords } from '@/lib/checks/target-keywords';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';
import type { PageSEOData, TargetKeyword } from '@/types';

const page = seoPage({
  url: 'https://example.com/de/webdesign-hamburg', title: 'Webdesign in Hamburg | Beckmann Digital',
  h1s: ['Webdesign für Hamburger KMU'], metaDescription: 'Webdesign aus Hamburg: schnell, barrierearm, gut zu finden.',
});

function run(pages: PageSEOData[], kws: TargetKeyword[] | undefined) {
  const log = new CheckLog(['seo']);
  const f = generateTargetKeywordFindings(pages, kws, log);
  return { f, entry: log.entries().find(e => e.check === 'target-keyword')! };
}

describe('target keyword (ultimate-41, point 13)', () => {
  it('no input: not configured', () => {
    expect(run([page], undefined).entry.status).toBe('not-configured');
    expect(run([page], []).entry.status).toBe('not-configured');
  });

  it('every word in title, H1, description and URL, by path or URL, case and umlauts folded: passed', () => {
    expect(missingPlaces(page, 'Webdesign Hamburg')).toEqual([]);
    expect(run([page], [{ url: '/de/webdesign-hamburg/', keyword: 'webdesign HAMBURG' }]).entry.status).toBe('pass');
    expect(run([page], [{ url: 'https://example.com/de/webdesign-hamburg', keyword: 'Webdesign' }]).entry.status).toBe('pass');
  });

  it('URL with transliterated umlauts', () => {
    const p = seoPage({ url: 'https://example.com/de/barrierefreiheit-pruefen', title: 'Barrierefreiheit prüfen', h1s: ['Barrierefreiheit prüfen'], metaDescription: 'Barrierefreiheit prüfen lassen.' });
    expect(missingPlaces(p, 'Barrierefreiheit prüfen')).toEqual([]);
  });

  it('missing places named; recommended per page', () => {
    const r = run([page], [{ url: '/de/webdesign-hamburg', keyword: 'SEO Beratung' }]);
    expect(r.f).toHaveLength(1);
    expect(r.f[0]).toMatchObject({ code: 'seo.target-keyword-missing', priority: 'recommended', affectedUrl: page.url });
    expect(r.f[0].title_en).toBe('Target keyword "SEO Beratung" missing in Title, H1, Description, URL');
    expect(r.entry.status).toBe('fail');
  });

  it('a page not crawled: not checkable, never passed', () => {
    expect(run([page], [{ url: '/de/kontakt', keyword: 'Kontakt' }]).entry.status).toBe('not-checkable');
    expect(run([page], [{ url: '/de/webdesign-hamburg', keyword: 'Webdesign' }, { url: '/de/kontakt', keyword: 'Kontakt' }]).entry.status).toBe('not-checkable');
  });

  it('the request body: a list of { url, keyword }, at most 50, keyword up to 80 characters, path or http(s) URL', () => {
    expect(validateTargetKeywords(undefined)).toEqual({ ok: true });
    expect(validateTargetKeywords([{ url: ' /a ', keyword: ' x ' }])).toEqual({ ok: true, value: [{ url: '/a', keyword: 'x' }] });
    expect(validateTargetKeywords('x')).toMatchObject({ ok: false });
    expect(validateTargetKeywords([{ url: '/a' }])).toMatchObject({ ok: false });
    expect(validateTargetKeywords([{ url: 'javascript:alert(1)', keyword: 'x' }])).toMatchObject({ ok: false });
    expect(validateTargetKeywords([{ url: '/a', keyword: 'x'.repeat(81) }])).toMatchObject({ ok: false });
    expect(validateTargetKeywords(Array.from({ length: 51 }, () => ({ url: '/a', keyword: 'x' })))).toMatchObject({ ok: false });
  });
});
