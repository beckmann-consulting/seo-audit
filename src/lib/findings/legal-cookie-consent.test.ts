// ultimate-41, point 17: the cookie-consent finding only when cookies or trackers are seen without a consent tool.
import { describe, it, expect } from 'vitest';
import { generateLegalFindings } from './legal';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';
import type { PageSEOData } from '@/types';

const HTML = '<html><body><a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></body></html>';

function run(pages: PageSEOData[], html = HTML) {
  const log = new CheckLog(['legal']);
  const findings = generateLegalFindings(pages, html, log);
  const consent = findings.find(f => f.code === 'legal.cookie-consent');
  const entry = log.entries().find(e => e.check === 'cookie-consent')!;
  return { consent, entry };
}

describe('legal.cookie-consent (ultimate-41, point 17)', () => {
  it('no cookies and no trackers: no finding, the check passed', () => {
    const { consent, entry } = run([seoPage({ setCookieCount: 0, setCookieNames: [] })]);
    expect(consent).toBeUndefined();
    expect(entry).toMatchObject({ status: 'pass', findingCodes: [] });
    expect(entry.summary_en).toMatch(/No cookies and no trackers/);
  });

  it('a cookie without a consent tool: finding, naming the cookie', () => {
    const { consent, entry } = run([seoPage({ setCookieCount: 1, setCookieNames: ['_ga'] })]);
    expect(consent).toMatchObject({ priority: 'important', module: 'legal' });
    expect(consent?.description_en).toMatch(/cookies on 1 page\(s\): _ga/);
    expect(entry).toMatchObject({ status: 'fail', findingCodes: ['legal.cookie-consent'] });
  });

  it('an analytics script without a consent tool: finding; a CDN script alone is no tracker', () => {
    const ga = run([seoPage({ setCookieCount: 0, thirdPartyScripts: [{ domain: 'www.googletagmanager.com', category: 'analytics', isRenderBlocking: false }] })]);
    expect(ga.consent?.description_en).toMatch(/trackers: www\.googletagmanager\.com \(analytics\)/);
    const cdn = run([seoPage({ setCookieCount: 0, thirdPartyScripts: [{ domain: 'cdn.jsdelivr.net', category: 'cdn', isRenderBlocking: false }] })]);
    expect(cdn.consent).toBeUndefined();
  });

  it('an inline Meta pixel without a consent tool: finding', () => {
    const { consent } = run([seoPage({ setCookieCount: 0, inlineTrackers: ['meta-pixel'] })]);
    expect(consent?.description_en).toMatch(/meta-pixel \(inline\)/);
  });

  it('with a consent tool: no finding, the check passed', () => {
    const { consent, entry } = run([seoPage({ setCookieCount: 2, setCookieNames: ['_ga', 'sid'] })], `${HTML}<script src="https://consent.cookiebot.com/uc.js"></script>`);
    expect(consent).toBeUndefined();
    expect(entry).toMatchObject({ status: 'pass' });
    expect(entry.summary_en).toBe('Consent tool found.');
  });

  it('pipelines without cookie data (widget, free check) keep the rule of before', () => {
    const findings = generateLegalFindings([seoPage({})], HTML);
    expect(findings.find(f => f.code === 'legal.cookie-consent')).toBeDefined();
  });
});
