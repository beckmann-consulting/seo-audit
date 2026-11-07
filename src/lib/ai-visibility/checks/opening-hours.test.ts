// websites-33: openingHoursSpecification counts as openingHours, in check 4
// of the AI module and in the SEO module's recommended fields.

import { describe, expect, it } from 'vitest';
import { checkStructured } from './structured';
import { generateStructuredDataFindings } from '@/lib/findings/seo';
import { hasFieldOrEquivalent } from '@/lib/schema-fields';
import { seoPage, schema } from '../__fixtures__/pages';

// the LocalBusiness node of beckmanndigital.com (siteJsonLd.ts), Monday to Friday 9 to 18
const BECKMANN = {
  '@id': 'https://beckmanndigital.com/#business',
  name: 'Beckmann Digital',
  url: 'https://beckmanndigital.com/de',
  email: 'digital@twb-consultancy.services',
  telephone: '+4917687842878',
  image: 'https://beckmanndigital.com/og/home-en.jpg',
  logo: 'https://beckmanndigital.com/logo.svg',
  address: { '@type': 'PostalAddress', streetAddress: 'Archbishop Makarios III 22, Makaria Center, 5th Floor, Office 501', addressLocality: 'Larnaca', postalCode: '6017', addressCountry: 'CY' },
  geo: { '@type': 'GeoCoordinates', latitude: 34.9213, longitude: 33.637 },
  openingHoursSpecification: [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], opens: '09:00', closes: '18:00' },
  ],
  sameAs: ['https://share.google/85RkQ3qNR9zzqGkFw'],
};
const site = schema('WebSite', { name: 'Beckmann Digital', url: 'https://beckmanndigital.com/de' });

function variant(fields: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...BECKMANN, ...fields };
  for (const [k, v] of Object.entries(fields)) if (v === undefined) delete data[k];
  return [seoPage({ url: 'https://beckmanndigital.com/de', wordCount: 700, schemas: [schema('LocalBusiness', data), site] })];
}

const aiMissing = (pages: ReturnType<typeof variant>) =>
  checkStructured({ pages, faqPages: [], modules: ['ai'] }).findings.filter(f => /Recommended fields missing/.test(f.title_en));
const seoMissing = (pages: ReturnType<typeof variant>) =>
  generateStructuredDataFindings(pages).filter(f => /incomplete LocalBusiness schema/.test(f.title_en));

describe('openingHours and openingHoursSpecification', () => {
  it('the LocalBusiness of beckmanndigital.com (openingHoursSpecification, Mo to Fr 9 to 18) misses no recommended field', () => {
    const pages = variant({});
    expect(aiMissing(pages)).toEqual([]);
    expect(seoMissing(pages)).toEqual([]);
  });

  it('only openingHours counts as well', () => {
    const pages = variant({ openingHoursSpecification: undefined, openingHours: 'Mo-Fr 09:00-18:00' });
    expect(aiMissing(pages)).toEqual([]);
    expect(seoMissing(pages)).toEqual([]);
  });

  it('only openingHoursSpecification counts', () => {
    expect(hasFieldOrEquivalent({ openingHoursSpecification: BECKMANN.openingHoursSpecification }, 'openingHours')).toBe(true);
    expect(hasFieldOrEquivalent({ openingHoursSpecification: [] }, 'openingHours')).toBe(false);
  });

  it('neither of them: openingHours is reported missing', () => {
    const pages = variant({ openingHoursSpecification: undefined });
    expect(aiMissing(pages)).toHaveLength(1);
    expect(aiMissing(pages)[0].description_en).toMatch(/openingHours/);
    expect(seoMissing(pages)).toHaveLength(1);
    expect(seoMissing(pages)[0].description_en).toMatch(/missing: openingHours/);
  });
});
