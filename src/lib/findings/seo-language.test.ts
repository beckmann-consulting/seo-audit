// ultimate-41, points 5 and 19: language signals per page; lang and og:locale on every page.
import { describe, it, expect } from 'vitest';
import { generateLanguageFindings, ownHreflang, ogLocaleAlternates } from './language';
import { seoPage, schema } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';
import type { PageSEOData } from '@/types';

const DE = 'https://example.com/de';
const EN = 'https://example.com/en';
const alternates = [{ hreflang: 'de', href: DE }, { hreflang: 'en', href: EN }, { hreflang: 'x-default', href: DE }];
const GERMAN_DESC = 'Wir entwickeln Websites für kleine und mittlere Unternehmen in der Region und kümmern uns um die Technik.';
const ENGLISH_DESC = 'We build websites for small and medium businesses in the region and take care of the technology.';

function run(pages: PageSEOData[], html: Record<string, string> = {}) {
  const log = new CheckLog(['seo']);
  const findings = generateLanguageFindings(pages, new Map(Object.entries(html)), log);
  const entry = (check: string) => log.entries().find(e => e.check === check)!;
  return { findings, codes: findings.map(f => f.code), entry };
}

const good = () => [
  seoPage({ url: DE, depth: 0, lang: 'de-DE', hreflangs: alternates, detectedLang: { lang: 'de', confidence: 0.9 }, schemas: [schema('LocalBusiness', { description: GERMAN_DESC })], ogTitle: 't', ogLocale: 'de_DE' }),
  seoPage({ url: EN, depth: 1, lang: 'en', hreflangs: alternates, detectedLang: { lang: 'en', confidence: 0.9 }, schemas: [schema('LocalBusiness', { description: ENGLISH_DESC })], ogTitle: 't', ogLocale: 'en_GB' }),
];
const fullHtml = {
  [DE]: '<html><head><meta property="og:locale:alternate" content="en_GB"></head></html>',
  [EN]: '<html><head><meta property="og:locale:alternate" content="de_DE"></head></html>',
};

describe('point 5: lang, hreflang, text and JSON-LD language (ultimate-41)', () => {
  it('everything consistent: no finding, both checks passed', () => {
    const r = run(good(), fullHtml);
    expect(r.findings).toEqual([]);
    expect(r.entry('language-consistency').status).toBe('pass');
    expect(r.entry('lang-and-og-locale').status).toBe('pass');
  });

  it('the own hreflang code is the entry pointing at the page itself (trailing slash ignored)', () => {
    expect(ownHreflang(seoPage({ url: `${EN}/`, hreflangs: alternates }))).toBe('en');
  });

  it('lang against hreflang, lang against the text', () => {
    const [de, en] = good();
    const r = run([de, { ...en, lang: 'de' }], fullHtml);
    expect(r.codes).toContain('seo.lang-hreflang-mismatch');
    expect(r.codes).toContain('seo.content-lang-mismatch');
    expect(r.entry('language-consistency')).toMatchObject({ status: 'fail' });
  });

  it('a German LocalBusiness description on the English page (the beckmanndigital.com case)', () => {
    const [de, en] = good();
    const r = run([de, { ...en, schemas: [schema('LocalBusiness', { description: GERMAN_DESC })] }], fullHtml);
    expect(r.codes).toEqual(['seo.jsonld-lang-mismatch']);
    expect(r.findings[0].description_en).toMatch(/LocalBusiness\.description: de ≠ en/);
  });

  it('short JSON-LD texts: 5 to 29 words decide only on clear evidence; fewer than 5 words are not judged', () => {
    const [de, en] = good();
    const shortDe = 'Agentur für Websites und Beratung'; // 5 words, für + und: German
    const mixed = 'Websites and Beratung für KMU'; // and + für: no answer
    const tiny = 'Websites und Beratung'; // 3 words
    expect(run([de, { ...en, schemas: [schema('Service', { description: shortDe })] }], fullHtml).codes).toEqual(['seo.jsonld-lang-mismatch']);
    expect(run([de, { ...en, schemas: [schema('Service', { description: mixed })] }], fullHtml).codes).toEqual([]);
    expect(run([de, { ...en, schemas: [schema('Service', { description: tiny })] }], fullHtml).codes).toEqual([]);
  });

  it('no second language signal anywhere: not applicable', () => {
    const r = run([seoPage({ url: DE, depth: 0 })]);
    expect(r.entry('language-consistency').status).toBe('not-applicable');
  });
});

describe('point 19: lang and og:locale on every page (ultimate-41)', () => {
  it('subpages without lang (recommended), with OG tags but without og:locale (optional)', () => {
    const [de, en] = good();
    const r = run([de, { ...en, lang: undefined, ogLocale: undefined, detectedLang: undefined }], fullHtml);
    expect(r.findings.filter(f => f.code === 'seo.html-lang-missing-pages').map(f => f.priority)).toEqual(['recommended']);
    expect(r.findings.filter(f => f.code === 'seo.og-locale-missing-pages').map(f => f.priority)).toEqual(['optional']);
  });

  it('og:locale:alternate checked against the complete list, the matching one at the eleventh place', () => {
    const many = Array.from({ length: 10 }, (_, i) => `<meta property="og:locale:alternate" content="x${i}_XX">`).join('');
    const html = { [DE]: `<html><head>${many}<meta property="og:locale:alternate" content="en_GB"></head></html>`, [EN]: fullHtml[EN] };
    expect(ogLocaleAlternates(html[DE])).toHaveLength(11);
    expect(run(good(), html).codes).toEqual([]);
    const without = { [DE]: `<html><head>${many}</head></html>`, [EN]: fullHtml[EN] };
    expect(run(good(), without).codes).toEqual(['seo.og-locale-alternate-missing']);
  });

  it('og:locale against lang', () => {
    const [de, en] = good();
    expect(run([de, { ...en, ogLocale: 'de_DE' }], fullHtml).codes).toEqual(['seo.og-locale-lang-mismatch']);
  });
});
