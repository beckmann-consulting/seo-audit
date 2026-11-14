// ultimate-41, points 5 and 6: small corrections of the existing hreflang rule (codes, URL comparison) and of the
// extractor (rel as a list of words).
import { describe, it, expect } from 'vitest';
import { generateHreflangFindings } from './seo';
import { extractPageSEO } from '@/lib/extractor';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';

describe('hreflang corrections (ultimate-41)', () => {
  it('codes: case does not matter, a three-digit region and a script are valid', () => {
    const hl = ['en-gb', 'EN-GB', 'es-419', 'zh-Hant', 'zh-Hant-TW', 'x-default', 'de'].map(c => ({ hreflang: c, href: 'https://example.com/' }));
    const f = generateHreflangFindings([seoPage({ url: 'https://example.com/', hreflangs: hl })]);
    expect(f.find(x => x.title_en.startsWith('Invalid hreflang values'))).toBeUndefined();
    const bad = generateHreflangFindings([seoPage({ url: 'https://example.com/', hreflangs: [{ hreflang: 'english', href: 'https://example.com/' }, { hreflang: 'de_DE', href: 'https://example.com/' }] })]);
    expect(bad.find(x => x.title_en.startsWith('Invalid hreflang values'))?.title_en).toBe('Invalid hreflang values: "english", "de_DE"');
  });

  it('self-reference: a trailing slash or a fragment is the same page', () => {
    const hl = [{ hreflang: 'de', href: 'https://example.com/de/#top' }, { hreflang: 'en', href: 'https://example.com/en' }];
    const f = generateHreflangFindings([seoPage({ url: 'https://example.com/de', hreflangs: hl })]);
    expect(f.find(x => x.title_en === 'Hreflang self-reference missing')).toBeUndefined();
  });

  it('the extractor reads rel as a list of words', () => {
    const html = '<html><head><link rel="alternate nofollow" hreflang="en" href="/en"><link rel="ALTERNATE" hreflang="de" href="/de"><link rel="stylesheet" hreflang="fr" href="/x.css"></head><body></body></html>';
    const p = extractPageSEO({ url: 'https://example.com/de', html, statusCode: 200, depth: 0, redirectChain: [], finalUrl: 'https://example.com/de', httpStatus: 200, protocol: null });
    expect(p.hreflangs).toEqual([{ hreflang: 'en', href: 'https://example.com/en' }, { hreflang: 'de', href: 'https://example.com/de' }]);
  });

  it('the extractor keeps the language of the visible text', () => {
    const text = 'Wir entwickeln Websites für kleine und mittlere Unternehmen in der Region. Unser Team kümmert sich um Gestaltung, Technik und Pflege, damit Ihre Seite schnell lädt und bei Google gefunden wird.';
    const p = extractPageSEO({ url: 'https://example.com/en', html: `<html lang="en"><body><p>${text}</p><script>var the = "and the of";</script></body></html>`, statusCode: 200, depth: 0, redirectChain: [], finalUrl: 'https://example.com/en', httpStatus: 200, protocol: null });
    expect(p.detectedLang?.lang).toBe('de');
  });
});
