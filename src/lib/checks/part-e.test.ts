// ultimate-41, part E: the check log entries of the two ai rules that websites-33 put in place.
import { describe, it, expect } from 'vitest';
import { recordOpeningHours, recordLastModified } from './part-e';
import { CheckLog } from './check-log';
import { seoPage, schema } from '@/lib/ai-visibility/__fixtures__/pages';
import type { Finding, SitemapInfo } from '@/types';

const F = (code: string): Finding => ({
  id: 'f1', code, priority: 'optional', module: 'ai', effort: 'low', impact: 'low',
  title_de: 't', title_en: 't', description_de: '', description_en: '', recommendation_de: '', recommendation_en: '',
});
const entry = (log: CheckLog, check: string) => log.entries().find(e => e.check === check)!;
const sitemap = (lastmod: string): SitemapInfo => ({ urls: [{ url: 'https://example.com/a', lastmod, imageCount: 0 }] } as unknown as SitemapInfo);
const page = (lastModified?: string) => [{ url: 'https://example.com/a', seo: { finalUrl: 'https://example.com/a' }, lastModified }];

describe('E1: opening hours (ultimate-41)', () => {
  it('openingHoursSpecification counts as openingHours: passed', () => {
    const log = new CheckLog(['ai']);
    recordOpeningHours(log, [seoPage({ schemas: [schema('ProfessionalService', { openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', opens: '09:00' }] })] })], []);
    expect(entry(log, 'ai-opening-hours')).toMatchObject({ status: 'pass' });
    expect(entry(log, 'ai-opening-hours').summary_en).toMatch(/1 of them only as openingHoursSpecification/);
  });

  it('neither field: fail with the finding of the field check; without that finding not checkable; no LocalBusiness: not applicable', () => {
    const pages = [seoPage({ schemas: [schema('LocalBusiness', { name: 'x' })] })];
    const a = new CheckLog(['ai', 'seo']);
    recordOpeningHours(a, pages, [F('seo.schema-recommended-fields')]);
    expect(entry(a, 'ai-opening-hours')).toMatchObject({ status: 'fail', findingCodes: ['seo.schema-recommended-fields'] });
    const b = new CheckLog(['ai']);
    recordOpeningHours(b, pages, []);
    expect(entry(b, 'ai-opening-hours').status).toBe('not-checkable');
    const c = new CheckLog(['ai']);
    recordOpeningHours(c, [seoPage({ schemas: [schema('Organization', {})] })], []);
    expect(entry(c, 'ai-opening-hours').status).toBe('not-applicable');
  });
});

describe('E2: Last-Modified (ultimate-41)', () => {
  it('Last-Modified much newer than lastmod (an upload stamped the files): passed, counted as a note', () => {
    const log = new CheckLog(['ai']);
    recordLastModified(log, page('Fri, 13 Nov 2026 10:00:00 GMT'), sitemap('2026-06-01'), []);
    expect(entry(log, 'ai-last-modified')).toMatchObject({ status: 'pass' });
    expect(entry(log, 'ai-last-modified').summary_en).toMatch(/1 pages compared; notes without points .*: 1/);
  });

  it('lastmod ahead of Last-Modified: fail with check 7 finding; not comparable: not checkable', () => {
    const a = new CheckLog(['ai']);
    recordLastModified(a, page('Mon, 01 Jun 2026 10:00:00 GMT'), sitemap('2026-11-01'), [F('ai.lastmod-ahead-of-last-modified')]);
    expect(entry(a, 'ai-last-modified')).toMatchObject({ status: 'fail', findingCodes: ['ai.lastmod-ahead-of-last-modified'] });
    const b = new CheckLog(['ai']);
    recordLastModified(b, page(undefined), sitemap('2026-11-01'), []);
    expect(entry(b, 'ai-last-modified').status).toBe('not-checkable');
    const c = new CheckLog(['ai']);
    recordLastModified(c, page('Mon, 01 Jun 2026 10:00:00 GMT'), sitemap('2026-11-01'), []);
    expect(entry(c, 'ai-last-modified').summary_en).toMatch(/did it run/);
  });
});
