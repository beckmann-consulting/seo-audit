// ultimate-41, point 10: name, address and phone from JSON-LD, imprint and footer.
import { describe, it, expect } from 'vitest';
import { generateNapFindings, normalisePhone, napFromText, normaliseStreet, samePhone, samePlace, namesFromText, napCountry } from './nap';
import { seoPage, schema } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';

const B = 'https://example.com';
const business = (extra: Record<string, unknown> = {}) => schema('ProfessionalService', {
  name: 'Beckmann Digital', telephone: '+49 40 1234567',
  address: { '@type': 'PostalAddress', streetAddress: 'Musterstraße 1', postalCode: '20095', addressLocality: 'Hamburg' }, ...extra,
});
const IMPRINT = '<html><body><h1>Impressum</h1><p>Beckmann Digital<br>Musterstr. 1<br>20095 Hamburg</p><p>Tel.: 040 / 123 45 67</p></body></html>';
const START = (tel = '+49401234567', zip = '20095') => `<html><body><main>Start</main><footer>Musterstraße 1 · ${zip} Hamburg · <a href="tel:${tel}">Anrufen</a></footer></body></html>`;

function run(schemas = [business()], imprint: string | null = IMPRINT, start = START(), lang?: string) {
  const pages = [seoPage({ url: `${B}/`, depth: 0, schemas, lang }), ...(imprint ? [seoPage({ url: `${B}/impressum`, depth: 1 })] : [])];
  const raw = [{ url: `${B}/`, html: start }, ...(imprint ? [{ url: `${B}/impressum`, html: imprint }] : [])];
  const log = new CheckLog(['seo']);
  const f = generateNapFindings(pages, raw, log);
  return { codes: f.map(x => [x.code, x.priority]), findings: f, entry: log.entries().find(e => e.check === 'nap-consistency')! };
}

describe('NAP (ultimate-41, point 10)', () => {
  it('the same phone, postcode and street in JSON-LD, imprint and footer: passed', () => {
    const r = run();
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
    expect(r.entry.summary_en).toMatch(/Matching in JSON-LD, Impressum, Footer/);
  });

  it('another phone in the footer: recommended, naming both values', () => {
    const r = run(undefined, undefined, START('+49409999999'));
    expect(r.codes).toEqual([['seo.nap-mismatch', 'recommended']]);
    expect(r.findings[0].description_en).toMatch(/phones: JSON-LD 49401234567 ≠ Footer 49409999999/);
  });

  it('another postcode in the imprint', () => {
    const r = run(undefined, IMPRINT.replace('20095', '20097'));
    expect(r.findings[0].description_en).toMatch(/postcodes: JSON-LD 20095 ≠ Impressum 20097/);
  });

  it('the JSON-LD name missing in the imprint: optional', () => {
    const r = run([business({ name: 'Beckmann Digital GmbH & Co. KG' })]);
    expect(r.codes).toEqual([['seo.nap-name-mismatch', 'optional']]);
  });

  it('only one source with data: not checkable; none: not applicable', () => {
    expect(run(undefined, undefined, '<html><body><footer>©</footer></body></html>').entry.status).toBe('pass'); // JSON-LD and imprint
    expect(run([business()], null, '<html><body><footer>©</footer></body></html>').entry.status).toBe('not-checkable');
    expect(run([], null, '<html><body></body></html>').entry.status).toBe('not-applicable');
  });

  it('normalising', () => {
    expect(normalisePhone('+49 (0)40 123 45 67')).toBe('49401234567');
    expect(normalisePhone('0049 40 1234567')).toBe('49401234567');
    expect(normalisePhone('040/1234567', '49')).toBe('49401234567');
    expect(normalisePhone('040/1234567')).toBe('0401234567'); // country unknown: stays national
    expect(normalisePhone('123')).toBeUndefined();
    expect(normaliseStreet('Musterstr. 1')).toBe(normaliseStreet('Musterstraße 1'));
    expect(normaliseStreet('Musterstrasse 1')).toBe(normaliseStreet('Musterstraße 1'));
    const n = napFromText('Fon: +49 40 1234567, Mobil 0170 1234567. Am Hafenweg 12a, 20457 Hamburg. USt-IdNr. DE123456789', { code: '49', zipDigits: 5 });
    expect([...n.phones]).toEqual(['49401234567', '491701234567']);
    expect([...n.postcodes]).toEqual(['20457']);
    expect([...n.streets]).toEqual([normaliseStreet('Hafenweg 12a')]);
  });

  it('normalising the town', () => {
    expect([...napFromText('60311 Frankfurt am Main').localities]).toEqual(['frankfurt am main']);
    expect([...napFromText('15230 Frankfurt (Oder)').localities]).toEqual(['frankfurt (oder)']);
    expect([...napFromText('61348 Bad Homburg vor der Höhe').localities]).toEqual(['bad homburg vor der höhe']);
    expect([...napFromText('06108 Halle (Saale)').localities]).toEqual(['halle (saale)']);
    expect([...napFromText('20095 Hamburg Telefon: 040 1234567').localities]).toEqual(['hamburg']);
    expect([...napFromText('20095 Hamburg Deutschland').localities]).toEqual(['hamburg']);
    expect([...napFromText('20095 Hamburg, Deutschland').localities]).toEqual(['hamburg']);
    expect([...napFromText('Sitz 20095 Hamburg · Lager 21129 Hamburg-Finkenwerder').localities]).toEqual(['hamburg', 'hamburg-finkenwerder']);
  });

  // Codex, review of 38125c21b6: a sentence mark ends the town and is no part of it
  it('normalising the town at the end of a sentence', () => {
    expect([...napFromText('15230 Frankfurt (Oder).').localities]).toEqual(['frankfurt (oder)']);
    expect([...napFromText('20095 Hamburg.').localities]).toEqual(['hamburg']);
    expect([...napFromText('20095 Hamburg. Wir sind für Sie da.').localities]).toEqual(['hamburg']);
    expect([...napFromText('60311 Frankfurt am Main.').localities]).toEqual(['frankfurt am main']);
    expect([...napFromText('33790 Halle (Westf.).').localities]).toEqual(['halle (westf.)']);
    expect([...napFromText('66386 St. Ingbert').localities]).toEqual(['st. ingbert']);
    expect([...napFromText('(Sitz: 20095 Hamburg)').localities]).toEqual(['hamburg']);
    expect(samePlace('frankfurt', [...napFromText('15230 Frankfurt (Oder).').localities][0])).toBe(false);
    expect(samePlace('hamburg', [...napFromText('20095 Hamburg.').localities][0])).toBe(true);
  });

  // Codex, review of 8a236e0713: only an addition like "am Main" may follow the short form, never a bracket or a word
  it('comparing towns', () => {
    expect(samePlace('frankfurt', 'frankfurt (oder)')).toBe(false);
    expect(samePlace('halle', 'halle (saale)')).toBe(false);
    expect(samePlace('bad', 'bad homburg')).toBe(false);
    expect(samePlace('bad homburg', 'bad vilbel')).toBe(false);
    expect(samePlace('frankfurt', 'frankfurt am main')).toBe(true);
    expect(samePlace('frankfurt am main', 'frankfurt')).toBe(true);
    expect(samePlace('bad homburg', 'bad homburg vor der höhe')).toBe(true);
    expect(samePlace('neustadt', 'neustadt a. d. weinstraße')).toBe(true);
    expect(samePhone('0401234567', '49401234567')).toBe(true);
    expect(samePhone('0401234567', '4940123456')).toBe(false);
    expect(samePhone('49401234567', '43401234567')).toBe(false);
  });
});

// Codex, review of 32e99e2094 (finding 1): town and names per source, the country code from the address or the language
describe('NAP: town, names and country (Codex finding 1)', () => {
  it('Frankfurt in JSON-LD without postcode, Frankfurt (Oder) in imprint and footer: recommended (was "pass")', () => {
    const ffo = business({ address: { '@type': 'PostalAddress', streetAddress: 'Musterstraße 1', addressLocality: 'Frankfurt' } });
    const r = run([ffo], IMPRINT.replace('20095 Hamburg', '15230 Frankfurt (Oder)'), START().replace('20095 Hamburg', '15230 Frankfurt (Oder)'));
    expect(r.codes).toEqual([['seo.nap-mismatch', 'recommended']]);
    expect(r.findings[0].description_en).toMatch(/localities: JSON-LD frankfurt ≠ Impressum frankfurt \(oder\); localities: JSON-LD frankfurt ≠ Footer frankfurt \(oder\)/);
    expect(r.entry.status).toBe('fail');
  });

  it('Frankfurt in JSON-LD, "15230 Frankfurt (Oder)." with a full stop in imprint and footer: recommended', () => {
    const ffo = business({ address: { '@type': 'PostalAddress', streetAddress: 'Musterstraße 1', addressLocality: 'Frankfurt' } });
    const r = run([ffo], IMPRINT.replace('20095 Hamburg', '15230 Frankfurt (Oder).'), START().replace('20095 Hamburg', '15230 Frankfurt (Oder).'));
    expect(r.codes).toEqual([['seo.nap-mismatch', 'recommended']]);
    expect(r.findings[0].description_en).toMatch(/localities: JSON-LD frankfurt ≠ Impressum frankfurt \(oder\); localities: JSON-LD frankfurt ≠ Footer frankfurt \(oder\)/);
  });

  it('"20095 Hamburg." with a full stop in imprint and footer matches Hamburg: passed', () => {
    const r = run(undefined, IMPRINT.replace('20095 Hamburg', '20095 Hamburg.'), START().replace('20095 Hamburg', '20095 Hamburg.'));
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
  });

  // Prüfer, review of ed5aac59bd: a malformed escape in a tel: link threw URIError and ended the whole audit
  it('a tel: link with a malformed escape is skipped, the other numbers still count', () => {
    const bad = '<html><body><main>Start</main><footer>Musterstraße 1 · 20095 Hamburg · <a href="tel:+4940123456%ZZ">Kaputt</a> <a href="tel:+49401234567">Anrufen</a></footer></body></html>';
    const r = run(undefined, IMPRINT.replace('</body>', '<a href="tel:%E0%A4%A">x</a></body>'), bad);
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
    expect(r.entry.summary_en).toMatch(/Footer: 1 phone\(s\)/);
    const only = run(undefined, undefined, '<html><body><footer>20095 Hamburg <a href="tel:+4940123456%ZZ">Kaputt</a></footer></body></html>');
    expect(only.entry.summary_en).toMatch(/Footer: 0 phone\(s\)/);
  });

  it('Bad Homburg in JSON-LD, Bad Vilbel in the imprint: recommended (the first word alone matched before)', () => {
    const r = run([business({ address: { '@type': 'PostalAddress', streetAddress: 'Musterstraße 1', postalCode: '20095', addressLocality: 'Bad Homburg' } })],
      IMPRINT.replace('20095 Hamburg', '20095 Bad Vilbel'), START().replace('20095 Hamburg', '20095 Bad Homburg'));
    expect(r.codes).toEqual([['seo.nap-mismatch', 'recommended']]);
    expect(r.findings[0].description_en).toMatch(/localities: JSON-LD bad homburg ≠ Impressum bad vilbel/);
  });

  it('another town in the imprint, same postcode: recommended', () => {
    const r = run(undefined, IMPRINT.replace('20095 Hamburg', '20095 Bremen'));
    expect(r.codes).toEqual([['seo.nap-mismatch', 'recommended']]);
    expect(r.findings[0].description_en).toMatch(/localities: JSON-LD hamburg ≠ Impressum bremen/);
  });

  it('a town given with its addition matches the short form', () => {
    const r = run([business({ address: { streetAddress: 'Musterstraße 1', postalCode: '20095', addressLocality: 'Hamburg am Meer' } })]);
    expect(r.codes).toEqual([]);
  });

  it('another business name in the footer: optional, naming both', () => {
    const r = run(undefined, undefined, START().replace('<footer>', '<footer><p>© 2026 Muster GmbH</p>'));
    expect(r.codes).toEqual([['seo.nap-name-mismatch', 'optional']]);
    expect(r.findings[0].description_en).toMatch(/Footer "Muster GmbH" ≠ Impressum/);
    expect(r.findings[0].description_en).toMatch(/JSON-LD "Beckmann Digital" ≠ Footer "Muster GmbH"/);
  });

  it('the same name in the footer, with year and legal form: passed', () => {
    const r = run([business({ legalName: 'Beckmann Digital GmbH' })], IMPRINT.replace('Beckmann Digital<br>', 'Beckmann Digital GmbH<br>'),
      START().replace('<footer>', '<footer><p>Copyright © 2019–2026 Beckmann Digital GmbH. Alle Rechte vorbehalten.</p>'));
    expect(r.codes).toEqual([]);
    expect(r.entry.summary_en).toMatch(/Footer: 1 phone\(s\), 1 postcode\(s\), 1 town\(s\), 1 street\(s\), 1 name\(s\)/);
  });

  it('a footer in the form of beckmanndigital.com (spans styled as blocks): the brand after © matches, the company too', () => {
    const footer = START().replace('<footer>', '<footer><p class="text-center"><span class="block">© 2026 Beckmann Digital</span><span class="block">Ein Brand der</span><span class="block">TW Beckmann Consultancy Services Ltd.</span></p>');
    const r = run(undefined, IMPRINT.replace('<p>Beckmann Digital<br>', '<p>Beckmann Digital, ein Brand der TW Beckmann Consultancy Services Ltd.<br>'), footer);
    expect(r.codes).toEqual([]);
    expect(r.entry.summary_en).toMatch(/Footer: .*, 2 name\(s\)/);
  });

  it('reads names after © and with a legal form', () => {
    expect([...namesFromText('© 2026\nBeckmann Digital\nEin Brand der')]).toEqual(['Beckmann Digital']);
    expect([...namesFromText('TW Beckmann Consultancy Services Ltd.')]).toEqual(['TW Beckmann Consultancy Services Ltd']);
    expect([...namesFromText('© 2026 Beckmann Digital | Impressum')]).toEqual(['Beckmann Digital']);
    expect([...namesFromText('Ein Angebot der Muster Bau GmbH & Co. KG, Hamburg')]).toEqual(['Muster Bau GmbH & Co. KG']);
    expect([...namesFromText('© 2026. Alle Rechte vorbehalten.')]).toEqual([]);
  });

  const AT = (tel: string) => schema('LocalBusiness', {
    name: 'Beckmann Digital', telephone: tel,
    address: { '@type': 'PostalAddress', streetAddress: 'Mustergasse 1', postalCode: '1010', addressLocality: 'Wien', addressCountry: 'AT' },
  });
  const AT_IMPRINT = '<html><body><h1>Impressum</h1><p>Beckmann Digital<br>Mustergasse 1<br>1010 Wien</p><p>Tel.: 01 234 56 78</p></body></html>';
  const AT_START = '<html><body><footer>© 2024 Beckmann Digital · Mustergasse 1 · 1010 Wien · <a href="tel:+4312345678">Anrufen</a></footer></body></html>';

  it('an Austrian site: the national number gets +43 from addressCountry, four-digit postcodes count', () => {
    const r = run([AT('+43 1 2345678')], AT_IMPRINT, AT_START);
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
    expect(r.entry.summary_en).toMatch(/country code \+43 \(from addressCountry AT\)/);
    expect(r.entry.summary_en).toMatch(/Impressum: 1 phone\(s\), 1 postcode\(s\), 1 town\(s\)/);
    expect(r.entry.summary_en).toMatch(/Footer: 1 phone\(s\), 1 postcode\(s\), 1 town\(s\), 1 street\(s\), 1 name\(s\)/); // © 2024 is no postcode
  });

  it('an Austrian site with a German number in JSON-LD: the mismatch is found (with +49 for all it was not)', () => {
    const r = run([AT('+49 1 2345678')], AT_IMPRINT, AT_START);
    expect(r.codes).toEqual([['seo.nap-mismatch', 'recommended']]);
    expect(r.findings[0].description_en).toMatch(/phones: JSON-LD 4912345678 ≠ Impressum 4312345678/);
  });

  it('the country from the language when the address gives none; unknown keeps national numbers national', () => {
    expect(napCountry([seoPage({ lang: 'de-CH' })], seoPage({ lang: 'de-CH' }))).toMatchObject({ code: '41', zipDigits: 4, source: 'lang de-CH' });
    expect(napCountry([seoPage({ lang: 'fr' })], seoPage({ lang: 'fr' }))).toMatchObject({ code: '33', zipDigits: 5 });
    expect(napCountry([seoPage({ lang: 'en' })], seoPage({ lang: 'en' })).code).toBeUndefined();
    const r = run(undefined, IMPRINT, START(), 'en');
    expect(r.codes).toEqual([]);
    expect(r.entry.summary_en).toMatch(/country code not derivable/);
  });
});
