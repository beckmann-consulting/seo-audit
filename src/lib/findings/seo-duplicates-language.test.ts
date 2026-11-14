// ultimate-41, point 7: DE/EN versions joined by hreflang are no duplicates of each other.
import { describe, it, expect } from 'vitest';
import { generateDuplicateContentFindings } from './seo';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';
import type { PageSEOData } from '@/types';

const pair = (path: string, title: string, h1: string): PageSEOData[] => {
  const de = `https://example.com/de${path}`;
  const en = `https://example.com/en${path}`;
  const hreflangs = [{ hreflang: 'de', href: de }, { hreflang: 'en', href: en }];
  return [
    seoPage({ url: de, lang: 'de', title, h1s: [h1], metaDescription: `${title} Beschreibung`, hreflangs }),
    seoPage({ url: en, lang: 'en', title, h1s: [h1], metaDescription: `${title} description`, hreflangs }),
  ];
};

function run(pages: PageSEOData[]) {
  const log = new CheckLog(['seo']);
  const findings = generateDuplicateContentFindings(pages, log);
  return { codes: findings.filter(f => f.code?.startsWith('seo.duplicate-')).map(f => f.code), entry: log.entries().find(e => e.check === 'language-pairs')! };
}

describe('language pairs (ultimate-41, point 7)', () => {
  it('a DE/EN pair with the same title and H1 is no duplicate', () => {
    const r = run([...pair('/kontakt', 'Beckmann Digital', 'Kontakt'), ...pair('/leistungen', 'Leistungen Beckmann', 'Leistungen')]);
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
    expect(r.entry.summary_en).toMatch(/2 hreflang group\(s\); 4 duplicate group\(s\) excluded/);
  });

  it('a real duplicate stays: two German pages with one title, besides a pair', () => {
    const pages = [...pair('/a', 'Gleicher Titel', 'A'), seoPage({ url: 'https://example.com/de/b', lang: 'de', title: 'Gleicher Titel', h1s: ['B'] })];
    const r = run(pages);
    expect(r.codes).toEqual(['seo.duplicate-title']);
    expect(r.entry).toMatchObject({ status: 'fail', findingCodes: ['seo.duplicate-title'] });
  });

  it('two pages of one language in one hreflang group are still duplicates', () => {
    const hreflangs = [{ hreflang: 'de', href: 'https://example.com/de/a' }, { hreflang: 'de-AT', href: 'https://example.com/at/a' }];
    const pages = [
      seoPage({ url: 'https://example.com/de/a', lang: 'de', title: 'Gleich', h1s: ['x'], hreflangs }),
      seoPage({ url: 'https://example.com/at/a', lang: 'de-AT', title: 'Gleich', h1s: ['y'], hreflangs }),
    ];
    expect(run(pages).codes).toEqual(['seo.duplicate-title']);
  });

  it('without hreflang nothing is guessed from the path', () => {
    const pages = [
      seoPage({ url: 'https://example.com/de/a', lang: 'de', title: 'Gleich', h1s: ['x'] }),
      seoPage({ url: 'https://example.com/en/a', lang: 'en', title: 'Gleich', h1s: ['y'] }),
    ];
    expect(run(pages).codes).toEqual(['seo.duplicate-title']);
  });
});
