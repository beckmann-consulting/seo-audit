import { describe, it, expect } from 'vitest';
import { checkStructured } from './structured';
import { generateStructuredDataFindings } from '@/lib/findings/seo';
import { seoPage, schema } from '../__fixtures__/pages';
import { extractMicrodata } from '@/lib/structured-data';
import { parse } from 'node-html-parser';

const org = schema('Organization', { name: 'Beckmann Digital', url: 'https://example.com/', logo: 'https://example.com/l.png', sameAs: ['https://www.linkedin.com/in/x'] });
const site = schema('WebSite', { name: 'Beckmann Digital', url: 'https://example.com/' });
const faqItem = { '@type': 'Question', name: 'Was kostet ein Audit?', acceptedAnswer: { '@type': 'Answer', text: 'Ab 490 Euro.' } };

describe('check 4: structured data for answers', () => {
  it('pass: Organization and WebSite on the start page, Service on the service page, FAQPage with the visible FAQ', () => {
    const pages = [
      seoPage({ url: 'https://example.com/', schemas: [org, site] }),
      seoPage({ url: 'https://example.com/leistungen/seo', schemas: [schema('Service', { name: 'SEO', provider: { '@type': 'Organization', name: 'B' }, serviceType: 'SEO', description: 'x', areaServed: 'DE' })] }),
      seoPage({ url: 'https://example.com/faq', schemas: [schema('FAQPage', { mainEntity: [faqItem] })] }),
    ];
    const o = checkStructured({ pages, faqPages: ['https://example.com/faq'], modules: ['ai', 'seo'] });
    expect(o.findings).toHaveLength(0);
    expect(o.result.status).toBe('pass');
  });

  it('fail: missing types per kind of page, ProfessionalService, Person without sameAs, Article author as text', () => {
    const pages = [
      seoPage({ url: 'https://example.com/', schemas: [] }),
      seoPage({ url: 'https://example.com/leistungen/audit', schemas: [schema('ProfessionalService', { name: 'B', address: 'x', telephone: '1' })] }),
      seoPage({ url: 'https://example.com/ueber-mich', schemas: [schema('Person', { name: 'Tobias' })] }),
      seoPage({ url: 'https://example.com/blog/a', schemas: [schema('Article', { headline: 'h', image: 'i', datePublished: '2026-11-06', author: 'Tobias' })] }),
    ];
    const o = checkStructured({ pages, faqPages: ['https://example.com/blog/a'], modules: ['ai', 'seo'] });
    const t = o.findings.map(f => f.title_en);
    expect(t).toEqual(expect.arrayContaining([
      'Start page without Organization or LocalBusiness in the JSON-LD',
      'Start page without WebSite in the JSON-LD',
      expect.stringMatching(/^Service pages without Service/),
      expect.stringMatching(/^Visible FAQ without FAQPage/),
      expect.stringMatching(/^Articles without a Person as author/),
      'ProfessionalService is deprecated at schema.org',
      expect.stringMatching(/^Person without sameAs/),
    ]));
    expect(o.findings.find(f => f.title_en.startsWith('Start page without Organization'))?.priority).toBe('important');
    expect(o.result.status).toBe('fail');
  });

  it('an Organization as an article\'s author is no Person (Codex, review of bcfe8de, F-008)', () => {
    const pages = [
      seoPage({ url: 'https://example.com/', schemas: [org, site] }),
      seoPage({ url: 'https://example.com/blog/a', schemas: [schema('Article', { headline: 'h', image: 'i', datePublished: '2026-11-06', author: { '@type': 'Organization', name: 'B' } })] }),
      seoPage({ url: 'https://example.com/blog/b', schemas: [schema('Article', { headline: 'h', image: 'i', datePublished: '2026-11-06', author: { '@type': 'Person', name: 'T', sameAs: ['https://x'] } })] }),
    ];
    const o = checkStructured({ pages, faqPages: [], modules: ['ai', 'seo'] });
    const f = o.findings.find(x => x.title_en.startsWith('Articles without a Person as author'));
    expect(f?.title_en).toBe('Articles without a Person as author: 1');
    expect(f?.description_en).toContain('https://example.com/blog/a');
    expect(f?.description_en).not.toContain('https://example.com/blog/b');
  });

  it('a LocalBusiness subtype counts as Organization-like and is checked against the LocalBusiness row', () => {
    const lb = schema('LegalService', { name: 'Kanzlei' }); // address and telephone missing
    const o = checkStructured({ pages: [seoPage({ url: 'https://example.com/', schemas: [lb, site] })], faqPages: [], modules: ['ai'] });
    expect(o.findings.map(f => f.title_en)).not.toContain('Start page without Organization or LocalBusiness in the JSON-LD');
    expect(o.findings.map(f => f.title_en)).toContainEqual(expect.stringMatching(/^Required fields missing in 1 answer schema/));
  });

  it('with seo active, missing required and recommended fields are seo findings and only shadow entries here', () => {
    const page = seoPage({ url: 'https://example.com/', schemas: [schema('Organization', { name: 'B' }), site] }); // url, logo, sameAs missing
    const ai = checkStructured({ pages: [page], faqPages: [], modules: ['ai', 'seo'] });
    expect(ai.findings.filter(f => /fields missing/.test(f.title_en))).toHaveLength(0);
    expect(ai.result.shadow.map(s => s.signal)).toEqual(['schema-required']);
    expect(ai.result.status).toBe('fail');
    const seo = generateStructuredDataFindings([page]);
    expect(seo.some(f => /Organization/.test(f.title_en))).toBe(true);
    // without seo, ai reports it itself
    const alone = checkStructured({ pages: [page], faqPages: [], modules: ['ai'] });
    expect(alone.findings.filter(f => /Required fields missing/.test(f.title_en))).toHaveLength(1);
  });

  it('seo now validates Service and LocalBusiness subtypes too (point 9)', () => {
    const seo = generateStructuredDataFindings([seoPage({ url: 'https://example.com/x', schemas: [schema('Service', { name: 'S' }), schema('LegalService', { name: 'K' })] })]);
    const text = seo.map(f => `${f.title_en} ${f.description_en}`).join(' ');
    expect(text).toMatch(/Service/);
    expect(text).toMatch(/LegalService|LocalBusiness/);
  });

  it('a broken JSON-LD block beside complete data fails the check: shadow with seo, own finding without (Prüfer-209)', () => {
    const page = seoPage({ url: 'https://example.com/', schemas: [org, site], schemaParseErrors: 1 });
    const withSeo = checkStructured({ pages: [page], faqPages: [], modules: ['ai', 'seo'] });
    expect(withSeo.result.status).toBe('fail');
    expect(withSeo.findings).toHaveLength(0);
    expect(withSeo.result.shadow).toEqual([{ signal: 'schema-parse', owner: 'seo', priority: 'important' }]);
    const alone = checkStructured({ pages: [page], faqPages: [], modules: ['ai'] });
    expect(alone.findings.map(f => f.title_en)).toEqual(['JSON-LD with parse errors on 1 page(s)']);
  });

  it('a FAQPage without question name and answer fails: shadow with seo, own finding without (Prüfer-211)', () => {
    const page = (mainEntity: unknown) => [
      seoPage({ url: 'https://example.com/', schemas: [org, site] }),
      seoPage({ url: 'https://example.com/faq', schemas: [schema('FAQPage', { mainEntity })] }),
    ];
    for (const mainEntity of [[{ '@type': 'Question' }], [faqItem, { '@type': 'Question', name: 'Wie lange?' }], faqItem]) {
      const pages = page(mainEntity);
      const withSeo = checkStructured({ pages, faqPages: ['https://example.com/faq'], modules: ['ai', 'seo'] });
      expect(withSeo.result.status).toBe('fail');
      expect(withSeo.findings).toHaveLength(0);
      expect(withSeo.result.shadow).toEqual([{ signal: 'schema-substructure', owner: 'seo', priority: 'important' }]);
      // the same rules as the SEO module, which reports it with the same priority
      const seo = generateStructuredDataFindings(pages).filter(f => /Schema substructure broken/.test(f.title_en));
      expect(seo.map(f => f.priority)).toEqual(['important']);
      const alone = checkStructured({ pages, faqPages: ['https://example.com/faq'], modules: ['ai'] });
      expect(alone.result.status).toBe('fail');
      expect(alone.findings.map(f => f.title_en)).toEqual(['Inner structure broken in 1 answer schema(s)']);
      expect(alone.findings[0].priority).toBe('important');
    }
    // a broken BreadcrumbList is no answer type: seo's alone
    const crumbs = [seoPage({ url: 'https://example.com/', schemas: [org, site, schema('BreadcrumbList', { itemListElement: [{ '@type': 'ListItem' }] })] })];
    expect(checkStructured({ pages: crumbs, faqPages: [], modules: ['ai'] }).result.status).toBe('pass');
  });

  it('FAQ entries must be typed Question and Answer, in the SEO and the AI path (Codex, review of 1e62f5d)', () => {
    const entries: unknown[] = [
      { '@type': 'Thing', name: 'Q', acceptedAnswer: { '@type': 'Thing', text: 'A' } },
      { name: 'Q', acceptedAnswer: { '@type': 'Answer', text: 'A' } },
      { '@type': 'Question', name: 'Q', acceptedAnswer: { '@type': 'Thing', text: 'A' } },
      { '@type': 'Question', name: 'Q', acceptedAnswer: { text: 'A' } },
    ];
    for (const entry of entries) {
      const pages = [
        seoPage({ url: 'https://example.com/', schemas: [org, site] }),
        seoPage({ url: 'https://example.com/faq', schemas: [schema('FAQPage', { mainEntity: [faqItem, entry] })] }),
      ];
      const label = JSON.stringify(entry);
      expect(generateStructuredDataFindings(pages).filter(f => /Schema substructure broken/.test(f.title_en)), label).toHaveLength(1);
      const withSeo = checkStructured({ pages, faqPages: ['https://example.com/faq'], modules: ['ai', 'seo'] });
      expect(withSeo.result.status, label).toBe('fail');
      expect(withSeo.result.shadow, label).toEqual([{ signal: 'schema-substructure', owner: 'seo', priority: 'important' }]);
      const alone = checkStructured({ pages, faqPages: ['https://example.com/faq'], modules: ['ai'] });
      expect(alone.findings.map(f => f.title_en), label).toEqual(['Inner structure broken in 1 answer schema(s)']);
      expect(alone.findings[0].description_en, label).toMatch(/without @type (Question|Answer)/);
    }
  });

  it('a microdata FAQ and a microdata Person as author pass: nested items keep their type', () => {
    const md = extractMicrodata(parse(`
      <div itemscope itemtype="https://schema.org/FAQPage">
        <div itemprop="mainEntity" itemscope itemtype="https://schema.org/Question"><span itemprop="name">Q1</span>
          <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer"><span itemprop="text">A1</span></div></div>
        <div itemprop="mainEntity" itemscope itemtype="https://schema.org/Question"><span itemprop="name">Q2</span>
          <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer"><span itemprop="text">A2</span></div></div>
      </div>
      <div itemscope itemtype="https://schema.org/BlogPosting">
        <span itemprop="headline">H</span><img itemprop="image" src="/i.png"><meta itemprop="datePublished" content="2026-11-06">
        <meta itemprop="dateModified" content="2026-11-07"><span itemprop="description">D</span>
        <span itemprop="author" itemscope itemtype="https://schema.org/Person"><span itemprop="name">Tobias</span></span>
        <span itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">B</span></span>
      </div>`));
    const pages = [seoPage({ url: 'https://example.com/', schemas: [org, site] }), seoPage({ url: 'https://example.com/faq', schemas: md })];
    for (const modules of [['ai', 'seo'], ['ai']] as const) {
      const o = checkStructured({ pages, faqPages: ['https://example.com/faq'], modules: [...modules] });
      expect(o.findings).toEqual([]);
      expect(o.result.status).toBe('pass');
    }
  });

  it('TechArticle is checked against the fields of Article: without datePublished it fails (Codex, review of 1e62f5d)', () => {
    const tech = schema('TechArticle', { headline: 'h', image: 'i', author: { '@type': 'Person', name: 'T', sameAs: ['https://x'] }, dateModified: '2026-11-07' });
    const pages = [seoPage({ url: 'https://example.com/', schemas: [org, site] }), seoPage({ url: 'https://example.com/docs/a', schemas: [tech] })];
    const withSeo = checkStructured({ pages, faqPages: [], modules: ['ai', 'seo'] });
    expect(withSeo.result.status).toBe('fail');
    expect(withSeo.result.shadow).toEqual([{ signal: 'schema-required', owner: 'seo', priority: 'recommended' }]);
    expect(generateStructuredDataFindings(pages).map(f => f.title_en)).toContain('Schema.org TechArticle: required fields missing (datePublished)');
    const alone = checkStructured({ pages, faqPages: [], modules: ['ai'] });
    expect(alone.result.status).toBe('fail');
    const f = alone.findings.find(x => /^Required fields missing in 1 answer schema/.test(x.title_en));
    expect(f?.description_en).toContain('TechArticle datePublished');
  });

  it('the shadow of missing required fields carries seo\'s priority (plan 3b)', () => {
    const page = seoPage({ url: 'https://example.com/', schemas: [schema('Organization', { name: 'B' }), site] });
    const ai = checkStructured({ pages: [page], faqPages: [], modules: ['ai', 'seo'] });
    const seo = generateStructuredDataFindings([page]).filter(f => /required fields missing/.test(f.title_en));
    expect(seo.map(f => f.priority)).toEqual(['recommended']);
    expect(ai.result.shadow).toEqual([{ signal: 'schema-required', owner: 'seo', priority: 'recommended' }]);
  });

  it('articles without dateModified (plan, completeness); NewsArticle stays with the recommended fields', () => {
    const art = (type: string, extra: Record<string, unknown>) => schema(type, { headline: 'h', image: 'i', datePublished: '2026-11-06', author: { '@type': 'Person', name: 'T', sameAs: ['https://x'] }, description: 'd', publisher: { '@type': 'Organization', name: 'B' }, mainEntityOfPage: 'https://example.com/a', ...extra });
    const pages = [
      seoPage({ url: 'https://example.com/', schemas: [org, site] }),
      seoPage({ url: 'https://example.com/blog/a', schemas: [art('BlogPosting', {})] }),
      seoPage({ url: 'https://example.com/blog/b', schemas: [art('Article', { dateModified: '2026-11-07' })] }),
      seoPage({ url: 'https://example.com/news/c', schemas: [art('NewsArticle', {})] }),
    ];
    for (const modules of [['ai', 'seo'], ['ai']] as const) {
      const o = checkStructured({ pages, faqPages: [], modules: [...modules] });
      const f = o.findings.filter(x => /dateModified/.test(x.title_en));
      expect(f.map(x => x.title_en)).toEqual(['Articles without dateModified: 1']);
      expect(f[0].priority).toBe('optional');
      expect(f[0].description_en).toContain('https://example.com/blog/a');
      expect(f[0].description_en).not.toContain('https://example.com/news/c');
    }
    // NewsArticle: a recommended field, seo's when active
    expect(checkStructured({ pages, faqPages: [], modules: ['ai', 'seo'] }).result.shadow.map(s => s.signal)).toEqual(['schema-recommended']);
  });

  it('not checkable: no page', () => {
    expect(checkStructured({ pages: [], faqPages: [], modules: ['ai'] }).result.status).toBe('not-checkable');
  });
});
