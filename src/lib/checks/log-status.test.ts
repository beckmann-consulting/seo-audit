// ultimate-41, Codex review of 32e99e2094 (finding 2): the check log status follows what was checked, not a set of
// findings that depends on the chosen modules. One world per case Codex named.
import { describe, it, expect } from 'vitest';
import { CheckLog } from './check-log';
import { recordScriptLoading, recordModernFormats } from './part-a';
import { generateLanguageFindings } from '@/lib/findings/language';
import { generateMetaNoindexFindings } from '@/lib/findings/local-and-index';
import { generateSEOFindings, generateXRobotsFindings } from '@/lib/findings/seo';
import { generatePerformanceFindings } from '@/lib/findings/performance';
import { generateThirdPartyScriptFindings } from '@/lib/findings/tech';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import type { Module } from '@/types';

const entry = (log: CheckLog, check: string) => log.entries().find(e => e.check === check)!;

describe('point 19: a start page without lang is no "lang everywhere"', () => {
  const pages = [
    seoPage({ url: 'https://example.com/', depth: 0, lang: undefined }),
    seoPage({ url: 'https://example.com/a', depth: 1, lang: 'de' }),
  ];

  it('fails with the start page rule of seo.ts (seo.html-lang-missing)', () => {
    const related = generateSEOFindings(pages, true, true);
    expect(related.map(f => f.code)).toContain('seo.html-lang-missing');
    const log = new CheckLog(['seo']);
    generateLanguageFindings(pages, new Map(), log, related);
    expect(entry(log, 'lang-and-og-locale')).toMatchObject({ status: 'fail', findingCodes: ['seo.html-lang-missing'] });
    expect(entry(log, 'lang-and-og-locale').summary_en).toMatch(/without lang: 1 \(the start page among them\)/);
  });

  it('never passes, even without that finding at hand', () => {
    const log = new CheckLog(['seo']);
    generateLanguageFindings(pages, new Map(), log);
    expect(entry(log, 'lang-and-og-locale').status).toBe('not-checkable');
  });
});

describe('point 18: a start page noindex by meta and by header', () => {
  const pages = [
    seoPage({ url: 'https://example.com/', depth: 0, hasNoindex: true, xRobotsNoindex: true, xRobotsTag: 'noindex' }),
    seoPage({ url: 'https://example.com/a', depth: 1 }),
  ];

  it('fails with the X-Robots-Tag finding, and the line counts the page', () => {
    const related = generateXRobotsFindings(pages);
    expect(related.map(f => f.code)).toContain('seo.x-robots-noindex');
    const log = new CheckLog(['seo']);
    const own = generateMetaNoindexFindings(pages, undefined, log, related);
    expect(own).toEqual([]); // the start page's meta finding stays the header rule's
    expect(entry(log, 'meta-noindex')).toMatchObject({ status: 'fail', findingCodes: ['seo.x-robots-noindex'] });
    expect(entry(log, 'meta-noindex').summary_en).toMatch(/1 of 2 pages with meta noindex \(the start page by X-Robots-Tag too\)/);
  });

  it('never says "none" when a page is noindex by meta', () => {
    const log = new CheckLog(['seo']);
    generateMetaNoindexFindings(pages, undefined, log);
    expect(entry(log, 'meta-noindex').status).toBe('not-checkable');
  });
});

describe('point 1: both parts measured whatever the modules; a violation without its finding is never "pass"', () => {
  const blocking = [seoPage({ url: 'https://example.com/', renderBlockingScripts: 5 })];
  const thirdParty = [seoPage({ url: 'https://example.com/', thirdPartyScripts: [{ domain: 'tracker.example', category: 'analytics', isRenderBlocking: true }] })];

  const run = (pages: typeof blocking, modules: Module[]) => {
    const findings = [
      ...(modules.includes('performance') ? generatePerformanceFindings(undefined, pages) : []),
      ...(modules.includes('tech') ? generateThirdPartyScriptFindings(pages) : []),
    ];
    const log = new CheckLog(modules);
    recordScriptLoading(log, pages, modules, findings);
    return entry(log, 'script-loading');
  };

  it('only tech chosen, 5 blocking <head> scripts, no third party: not checkable, naming the module, never pass', () => {
    const e = run(blocking, ['tech']);
    expect(e.status).toBe('not-checkable');
    expect(e.summary_en).toMatch(/^5 blocking scripts in the <head> \(limit 3\), no finding: module performance not chosen; 0 third-party domain\(s\)/);
  });

  it('only tech chosen, 2 blocking <head> scripts, no third party: passed, the count stands in the line', () => {
    const e = run([seoPage({ url: 'https://example.com/', renderBlockingScripts: 2 })], ['tech']);
    expect(e.status).toBe('pass');
    expect(e.summary_en).toMatch(/^2 blocking scripts in the <head> \(limit 3\); 0 third-party domain\(s\) with blocking scripts\./);
  });

  it('only tech chosen, both parts over the limit: fails with the tech finding, the <head> part named', () => {
    const both = [seoPage({ url: 'https://example.com/', renderBlockingScripts: 5, thirdPartyScripts: [{ domain: 'tracker.example', category: 'analytics', isRenderBlocking: true }] })];
    const e = run(both, ['tech']);
    expect(e).toMatchObject({ status: 'fail', findingCodes: ['tech.render-blocking-third-party'] });
    expect(e.summary_en).toMatch(/no finding: module performance not chosen/);
  });

  it('performance chosen: the same pages fail with the performance finding', () => {
    expect(run(blocking, ['performance'])).toMatchObject({ status: 'fail', findingCodes: ['performance.render-blocking-scripts'] });
  });

  it('tech chosen, a blocking third-party script: fails with the tech finding', () => {
    expect(run(thirdParty, ['tech'])).toMatchObject({ status: 'fail', findingCodes: ['tech.render-blocking-third-party'] });
  });

  it('point 16: the rule decides, not the finding list', () => {
    const log = new CheckLog(['tech']);
    recordModernFormats(log, [seoPage({ totalImages: 10, modernImageFormats: 2 })], []);
    expect(entry(log, 'modern-image-formats').status).toBe('not-checkable');
  });
});
