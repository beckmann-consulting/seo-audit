// ultimate-41, part E (journal ultimate-41-plan.md section 6): both rules came with websites-33 (#19); this only
// writes their check log entries per run, E1 (openingHoursSpecification counts as openingHours, check 4) and E2
// (Last-Modified against sitemap lastmod, check 7: only a lastmod ahead of Last-Modified is a finding).
import type { Finding, PageSEOData, SitemapInfo } from '@/types';
import { hasFieldOrEquivalent, schemaTableType } from '@/lib/schema-fields';
import { compareLastModified } from '@/lib/ai-visibility/checks/trust';
import type { CheckLog } from './check-log';

export function recordOpeningHours(checkLog: CheckLog, pages: PageSEOData[], allFindings: Finding[]): void {
  if (checkLog.isSelected('ai-opening-hours')) {
    const businesses = pages.flatMap(p => p.schemas.filter(sc => schemaTableType(sc.type) === 'LocalBusiness').map(sc => ({ url: p.url, data: sc.data })));
    const lacking = businesses.filter(b => !hasFieldOrEquivalent(b.data, 'openingHours'));
    const reported = allFindings.filter(f => f.code === 'ai.schema-recommended-fields' || f.code === 'seo.schema-recommended-fields');
    if (businesses.length === 0) {
      checkLog.record('ai-opening-hours', { status: 'not-applicable', summary_de: 'Kein LocalBusiness-Schema.', summary_en: 'No LocalBusiness schema.' });
    } else if (lacking.length === 0) {
      const spec = businesses.filter(b => !('openingHours' in b.data)).length;
      checkLog.record('ai-opening-hours', { status: 'pass', summary_de: `${businesses.length} LocalBusiness-Schema(s) mit Öffnungszeiten; ${spec} davon nur als openingHoursSpecification, das zählt gleich.`, summary_en: `${businesses.length} LocalBusiness schema(s) with opening hours; ${spec} of them only as openingHoursSpecification, which counts the same.` });
    } else if (reported.length > 0) {
      checkLog.record('ai-opening-hours', { status: 'fail', findings: reported, summary_de: `${lacking.length} LocalBusiness-Schema(s) ohne openingHours und ohne openingHoursSpecification.`, summary_en: `${lacking.length} LocalBusiness schema(s) without openingHours and without openingHoursSpecification.` });
    } else {
      checkLog.record('ai-opening-hours', { status: 'not-checkable', summary_de: `${lacking.length} LocalBusiness-Schema(s) ohne Öffnungszeiten, aber kein Befund der Feldprüfung.`, summary_en: `${lacking.length} LocalBusiness schema(s) without opening hours, but no finding of the field check.` });
    }
  }
}

export function recordLastModified(checkLog: CheckLog, pages: { url: string; seo: { finalUrl?: string }; lastModified?: string }[], sitemapInfo: SitemapInfo | undefined, allFindings: Finding[]): void {
  if (checkLog.isSelected('ai-last-modified')) {
    const cmp = compareLastModified(pages, sitemapInfo);
    const ahead = allFindings.filter(f => f.code === 'ai.lastmod-ahead-of-last-modified');
    if (ahead.length > 0) {
      checkLog.record('ai-last-modified', { status: 'fail', findings: ahead, summary_de: `lastmod auf ${cmp.gaps.length} Seite(n) mehr als 30 Tage neuer als Last-Modified.`, summary_en: `lastmod more than 30 days newer than Last-Modified on ${cmp.gaps.length} page(s).` });
    } else if (cmp.gaps.length > 0) {
      checkLog.record('ai-last-modified', { status: 'not-checkable', summary_de: `lastmod auf ${cmp.gaps.length} Seite(n) zu neu, aber Prüfung 7 gab keinen Befund (lief sie?).`, summary_en: `lastmod too new on ${cmp.gaps.length} page(s), but check 7 gave no finding (did it run?).` });
    } else if (cmp.compared === 0) {
      checkLog.record('ai-last-modified', { status: 'not-checkable', summary_de: `Nicht vergleichbar: ${cmp.withLastmod} Sitemap-Einträge mit lastmod, ${cmp.withLastModified} Seiten mit Last-Modified.`, summary_en: `Not comparable: ${cmp.withLastmod} sitemap entries with lastmod, ${cmp.withLastModified} pages with Last-Modified.` });
    } else {
      checkLog.record('ai-last-modified', { status: 'pass', summary_de: `${cmp.compared} Seiten verglichen; Hinweise ohne Punktabzug (Last-Modified neuer, z. B. nach einem Upload): ${cmp.newer.length}.`, summary_en: `${cmp.compared} pages compared; notes without points (Last-Modified newer, e.g. after an upload): ${cmp.newer.length}.` });
    }
  }
}
