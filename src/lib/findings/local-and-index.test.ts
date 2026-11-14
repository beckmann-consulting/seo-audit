// ultimate-41, points 18 and 11: meta noindex as findings of their own; Maps or Business Profile links.
import { describe, it, expect } from 'vitest';
import { generateMetaNoindexFindings, generateMapLinkFindings, isMapLink } from './local-and-index';
import { extractPageSEO } from '@/lib/extractor';
import { seoPage, schema } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';
import type { PageSEOData, SitemapInfo } from '@/types';

const sitemap = (urls: string[]): SitemapInfo => ({ urls: urls.map(url => ({ url, imageCount: 0 })) } as unknown as SitemapInfo);

function noindex(pages: PageSEOData[], sm?: SitemapInfo) {
  const log = new CheckLog(['seo']);
  const f = generateMetaNoindexFindings(pages, sm, log);
  return { f, codes: f.map(x => [x.code, x.priority]), entry: log.entries().find(e => e.check === 'meta-noindex')! };
}

describe('point 18: meta noindex (ultimate-41)', () => {
  it('none: passed', () => {
    const r = noindex([seoPage({ url: 'https://example.com/', depth: 0 }), seoPage({ url: 'https://example.com/a', depth: 1 })]);
    expect(r.f).toEqual([]);
    expect(r.entry.status).toBe('pass');
  });

  it('the start page by meta: critical; not when the header already says it (that rule is the X-Robots one)', () => {
    expect(noindex([seoPage({ url: 'https://example.com/', depth: 0, hasNoindex: true })]).codes).toEqual([['seo.noindex-home', 'critical']]);
    expect(noindex([seoPage({ url: 'https://example.com/', depth: 0, hasNoindex: true, xRobotsNoindex: true })]).codes).toEqual([]);
  });

  it('a noindex page in the sitemap (recommended), others to check (optional)', () => {
    const pages = [
      seoPage({ url: 'https://example.com/', depth: 0 }),
      seoPage({ url: 'https://example.com/a', depth: 1, hasNoindex: true }),
      seoPage({ url: 'https://example.com/impressum', depth: 1, hasNoindex: true }),
    ];
    const r = noindex(pages, sitemap(['https://example.com/a/']));
    expect(r.codes).toEqual([['seo.noindex-in-sitemap', 'recommended'], ['seo.noindex-pages', 'optional']]);
    expect(r.entry).toMatchObject({ status: 'fail', findingCodes: ['seo.noindex-in-sitemap', 'seo.noindex-pages'] });
  });

  it('the extractor reads meta robots "none" as noindex', () => {
    const p = extractPageSEO({ url: 'https://example.com/', html: '<html><head><meta name="robots" content="none"></head><body></body></html>', statusCode: 200, depth: 0, redirectChain: [], finalUrl: 'https://example.com/', httpStatus: 200, protocol: null });
    expect(p.hasNoindex).toBe(true);
  });
});

function maps(pages: PageSEOData[]) {
  const log = new CheckLog(['seo']);
  const f = generateMapLinkFindings(pages, log);
  return { codes: f.map(x => [x.code, x.priority]), entry: log.entries().find(e => e.check === 'maps-profile')! };
}

describe('point 11: Maps and Business Profile (ultimate-41)', () => {
  it('link patterns', () => {
    for (const u of ['https://www.google.com/maps/place/x', 'https://google.de/maps?cid=1', 'https://maps.google.com/?cid=1', 'https://maps.app.goo.gl/abc', 'https://goo.gl/maps/abc', 'https://g.page/r/abc', 'https://business.google.com/x', 'https://share.google/abc']) {
      expect(isMapLink(u), u).toBe(true);
    }
    for (const u of ['https://www.google.com/search?q=x', 'https://example.com/maps', 'https://www.linkedin.com/company/x']) expect(isMapLink(u), u).toBe(false);
  });

  it('no LocalBusiness: not applicable', () => {
    expect(maps([seoPage({ schemas: [schema('Organization', {})] })]).entry.status).toBe('not-applicable');
  });

  it('a LocalBusiness subtype without any reference: recommended', () => {
    expect(maps([seoPage({ schemas: [schema('ProfessionalService', { name: 'x' })] })]).codes).toEqual([['seo.local-map-link-missing', 'recommended']]);
  });

  it('a link on the site but not in the schema: optional; in hasMap or sameAs: passed', () => {
    const link = 'https://maps.app.goo.gl/abc';
    expect(maps([seoPage({ externalLinks: [link], schemas: [schema('LocalBusiness', {})] })]).codes).toEqual([['seo.local-hasmap-missing', 'optional']]);
    expect(maps([seoPage({ externalLinks: [link], schemas: [schema('LocalBusiness', { hasMap: link })] })]).entry.status).toBe('pass');
    expect(maps([seoPage({ schemas: [schema('LocalBusiness', { sameAs: ['https://www.linkedin.com/x', 'https://share.google/abc'] })] })]).entry.status).toBe('pass');
  });
});
