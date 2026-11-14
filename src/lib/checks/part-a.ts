// ultimate-41, points 1 and 16: their check log entries follow from what was measured, per chosen module, not from
// whichever findings happen to exist (Codex, review of 32e99e2094: with only tech chosen and more than three blocking
// scripts the entry said "pass" next to a count that the performance rule would flag).
//
// Point 1 has two parts: the performance rule (render-blocking scripts in the <head>, a finding above 3) and the tech
// rule (render-blocking third-party scripts other than CDNs, a finding from 1). Both parts are measured whatever the
// modules; a part over its limit whose finding is absent (its module not chosen) makes the entry "not checkable",
// never "pass", and the line names the module.
import type { Finding, Module, PageSEOData } from '@/types';
import type { CheckLog } from './check-log';

export const BLOCKING_LIMIT = 3; // performance.ts: a finding above this many blocking scripts in the <head>

export function blockingCounts(pages: PageSEOData[]): { head: number; thirdPartyDomains: number } {
  const head = pages.reduce((n, p) => n + p.renderBlockingScripts, 0);
  const domains = new Set<string>();
  for (const p of pages) for (const s of p.thirdPartyScripts ?? []) if (s.isRenderBlocking && s.category !== 'cdn') domains.add(s.domain);
  return { head, thirdPartyDomains: domains.size };
}

export function recordScriptLoading(log: CheckLog, pages: PageSEOData[], modules: readonly Module[], findings: Finding[]): void {
  if (!log.isSelected('script-loading')) return;
  const { head, thirdPartyDomains } = blockingCounts(pages);
  const perfViolates = head > BLOCKING_LIMIT;
  const techViolates = thirdPartyDomains > 0;
  const PARTS = [
    { violates: perfViolates, module: 'performance' as Module, code: 'performance.render-blocking-scripts',
      de: `${head} blockierende Scripts im <head> (Grenze ${BLOCKING_LIMIT})`, en: `${head} blocking scripts in the <head> (limit ${BLOCKING_LIMIT})` },
    { violates: techViolates, module: 'tech' as Module, code: 'tech.render-blocking-third-party',
      de: `${thirdPartyDomains} Dritt-Domain(s) mit blockierenden Scripts`, en: `${thirdPartyDomains} third-party domain(s) with blocking scripts` },
  ];
  // a part over its limit without its finding: say why the finding is not there
  const parts = PARTS.map(p => {
    const own = p.violates ? findings.filter(f => f.code === p.code) : [];
    const gap = p.violates && own.length === 0;
    const chosen = modules.includes(p.module);
    return {
      own, gap,
      de: p.de + (gap ? (chosen ? ', ohne zugehörigen Befund' : `, ohne Befund: Modul ${p.module} nicht gewählt`) : ''),
      en: p.en + (gap ? (chosen ? ', without its finding' : `, no finding: module ${p.module} not chosen`) : ''),
    };
  });
  const summary_de = `${parts.map(p => p.de).join('; ')}. async, defer und type="module" blockieren nicht.`;
  const summary_en = `${parts.map(p => p.en).join('; ')}. async, defer and type="module" do not block.`;
  const own = parts.flatMap(p => p.own);
  log.record('script-loading', !perfViolates && !techViolates
    ? { status: 'pass', summary_de, summary_en }
    : own.length > 0
      ? { status: 'fail', findings: own, summary_de, summary_en }
      : { status: 'not-checkable', summary_de, summary_en });
}

export function recordModernFormats(log: CheckLog, pages: PageSEOData[], findings: Finding[]): void {
  if (!log.isSelected('modern-image-formats')) return;
  const total = pages.reduce((n, p) => n + p.totalImages, 0);
  const modern = pages.reduce((n, p) => n + p.modernImageFormats, 0);
  const violates = total > 5 && modern / total < 0.5; // the rule of tech.ts
  const summary_de = `${modern} von ${total} Bildern in modernen Formaten (WebP, AVIF, SVG).`;
  const summary_en = `${modern} of ${total} images in modern formats (WebP, AVIF, SVG).`;
  if (!violates) {
    log.record('modern-image-formats', { status: total === 0 ? 'not-applicable' : 'pass', summary_de, summary_en });
    return;
  }
  const own = findings.filter(f => f.code === 'tech.modern-image-formats');
  log.record('modern-image-formats', own.length > 0
    ? { status: 'fail', findings: own, summary_de, summary_en }
    : { status: 'not-checkable', summary_de: `${summary_de} Der zugehörige Befund fehlt.`, summary_en: `${summary_en} The finding for it is missing.` });
}
