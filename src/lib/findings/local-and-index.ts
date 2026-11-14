// ultimate-41, points 18 and 11 (journal ultimate-41-plan.md section 5): meta noindex as findings of their own, and
// links to Google Maps or a Business Profile for a LocalBusiness.
import type { Finding, PageSEOData, SitemapInfo } from '@/types';
import { id } from './utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { schemaTableType } from '@/lib/schema-fields';
import type { CheckLog } from '@/lib/checks/check-log';

const sample = (xs: string[]) => xs.slice(0, 5).join(', ') + (xs.length > 5 ? ` (+${xs.length - 5})` : '');

// ---- point 18 ----

// `related`: the findings generated before, for the X-Robots-Tag finding (seo.x-robots-noindex) of a start page that is
// noindex by header as well: then that finding is the start page's, and the log entry carries it (Codex, review of
// 32e99e2094: the log said "none" while the start page was noindex by meta and header)
export function generateMetaNoindexFindings(pages: PageSEOData[], sitemap: SitemapInfo | undefined, log?: CheckLog, related: Finding[] = []): Finding[] {
  const findings: Finding[] = [];
  const start = pages.find(p => p.depth === 0) ?? pages[0];
  const inSitemap = new Set((sitemap?.urls ?? []).map(u => normaliseUrl(u.url)));
  const meta = pages.filter(p => p.hasNoindex);
  // the start page by header is the X-Robots-Tag rule's (seo.ts, critical); this one covers the meta tag
  if (start && start.hasNoindex && !start.xRobotsNoindex) {
    findings.push({
      id: id(), code: 'seo.noindex-home', priority: 'critical', module: 'seo', effort: 'low', impact: 'high', affectedUrl: start.url,
      title_de: 'Startseite steht per meta robots auf noindex', title_en: 'Start page is noindex by meta robots',
      description_de: 'Das Meta-Tag robots (oder googlebot) der Startseite enthält noindex oder none; Google nimmt sie nicht in den Index.',
      description_en: 'The robots (or googlebot) meta tag of the start page contains noindex or none; Google keeps it out of the index.',
      recommendation_de: 'noindex von der Startseite entfernen, sofern sie gefunden werden soll.', recommendation_en: 'Remove noindex from the start page if it is meant to be found.',
    });
  }
  const listed = meta.filter(p => p !== start && inSitemap.has(normaliseUrl(p.url))).map(p => p.url);
  if (listed.length > 0) findings.push({
    id: id(), code: 'seo.noindex-in-sitemap', priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium', affectedUrl: listed[0],
    title_de: `${listed.length} Seite(n) mit meta noindex stehen in der Sitemap`, title_en: `${listed.length} page(s) with meta noindex are in the sitemap`,
    description_de: `Die Sitemap meldet Seiten zur Indexierung, die per noindex ausgeschlossen sind: ${sample(listed)}.`,
    description_en: `The sitemap offers pages for indexing that noindex excludes: ${sample(listed)}.`,
    recommendation_de: 'Entweder noindex entfernen oder die Seiten aus der Sitemap nehmen.', recommendation_en: 'Either remove noindex or take the pages out of the sitemap.',
  });
  const others = meta.filter(p => p !== start && !inSitemap.has(normaliseUrl(p.url))).map(p => p.url);
  if (others.length > 0) findings.push({
    id: id(), code: 'seo.noindex-pages', priority: 'optional', module: 'seo', effort: 'low', impact: 'low', affectedUrl: others[0],
    title_de: `${others.length} Seite(n) mit meta noindex`, title_en: `${others.length} page(s) with meta noindex`,
    description_de: `Diese Seiten schließen sich per Meta-Tag aus dem Index aus: ${sample(others)}. Bei Impressum oder Danke-Seiten ist das oft gewollt.`,
    description_en: `These pages keep themselves out of the index by meta tag: ${sample(others)}. For imprint or thank-you pages this is often intended.`,
    recommendation_de: 'Prüfen, ob noindex auf jeder dieser Seiten gewollt ist.', recommendation_en: 'Check that noindex is intended on each of these pages.',
  });
  // the status follows the pages with meta noindex, not the findings alone
  const headerHome = start && start.hasNoindex && start.xRobotsNoindex ? related.filter(f => f.code === 'seo.x-robots-noindex') : [];
  const logFindings = [...findings, ...headerHome];
  log?.record('meta-noindex', meta.length === 0
    ? { status: 'pass', summary_de: `Keine der ${pages.length} Seiten steht per meta robots auf noindex.`, summary_en: `None of the ${pages.length} pages is noindex by meta robots.` }
    : logFindings.length > 0
      ? { status: 'fail', findings: logFindings, summary_de: `${meta.length} von ${pages.length} Seiten mit meta noindex${headerHome.length ? ' (die Startseite auch per X-Robots-Tag)' : ''}.`, summary_en: `${meta.length} of ${pages.length} pages with meta noindex${headerHome.length ? ' (the start page by X-Robots-Tag too)' : ''}.` }
      : { status: 'not-checkable', summary_de: `${meta.length} Seite(n) mit meta noindex, aber kein zugehöriger Befund.`, summary_en: `${meta.length} page(s) with meta noindex but no finding for them.` });
  return findings;
}

// ---- point 11 ----

const MAP_LINK = /^https?:\/\/(?:(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps|g\.page|business\.google\.com|share\.google)(?:[/?#]|$)/i;

export function isMapLink(url: string): boolean {
  return MAP_LINK.test(url.trim());
}

function stringsOf(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(stringsOf);
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return [(v as { url: string }).url];
  return [];
}

export function generateMapLinkFindings(pages: PageSEOData[], log?: CheckLog): Finding[] {
  const businesses = pages.flatMap(p => p.schemas.filter(s => schemaTableType(s.type) === 'LocalBusiness').map(s => ({ page: p, s })));
  if (businesses.length === 0) {
    log?.record('maps-profile', { status: 'not-applicable', summary_de: 'Kein LocalBusiness-Schema.', summary_en: 'No LocalBusiness schema.' });
    return [];
  }
  const links = [...new Set(pages.flatMap(p => p.externalLinks).filter(isMapLink))];
  const inSchema = [...new Set(businesses.flatMap(({ s }) => [...stringsOf(s.data.hasMap), ...stringsOf(s.data.sameAs)]).filter(isMapLink))];
  const findings: Finding[] = [];
  if (links.length === 0 && inSchema.length === 0) {
    findings.push({
      id: id(), code: 'seo.local-map-link-missing', priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium', affectedUrl: businesses[0].page.url,
      title_de: 'LocalBusiness ohne Link auf Google Maps oder das Unternehmensprofil', title_en: 'LocalBusiness without a link to Google Maps or the Business Profile',
      description_de: 'Weder ein Link auf der Website noch hasMap oder sameAs im Schema verweisen auf Google Maps oder das Google-Unternehmensprofil.',
      description_en: 'Neither a link on the site nor hasMap or sameAs in the schema points to Google Maps or the Google Business Profile.',
      recommendation_de: 'Den Maps- oder Profil-Link im Kontaktbereich verlinken und im LocalBusiness-Schema als hasMap angeben.',
      recommendation_en: 'Link the Maps or profile URL in the contact area and give it as hasMap in the LocalBusiness schema.',
    });
  } else if (links.length > 0 && inSchema.length === 0) {
    findings.push({
      id: id(), code: 'seo.local-hasmap-missing', priority: 'optional', module: 'seo', effort: 'low', impact: 'low', affectedUrl: businesses[0].page.url,
      title_de: 'Maps-Link vorhanden, aber nicht im LocalBusiness-Schema', title_en: 'Maps link present but not in the LocalBusiness schema',
      description_de: `Die Website verlinkt ${sample(links)}, das Schema nennt ihn weder in hasMap noch in sameAs.`,
      description_en: `The site links ${sample(links)}; the schema names it neither in hasMap nor in sameAs.`,
      recommendation_de: 'Den Link als hasMap (oder in sameAs) ins LocalBusiness-Schema aufnehmen.', recommendation_en: 'Add the link as hasMap (or in sameAs) to the LocalBusiness schema.',
    });
  }
  log?.record('maps-profile', findings.length > 0
    ? { status: 'fail', findings, summary_de: `${businesses.length} LocalBusiness-Schema(s); Links ${links.length}, im Schema ${inSchema.length}.`, summary_en: `${businesses.length} LocalBusiness schema(s); links ${links.length}, in the schema ${inSchema.length}.` }
    : { status: 'pass', summary_de: `Maps-/Profil-Verweis auf der Website und im Schema: ${sample([...inSchema, ...links])}.`, summary_en: `Maps or profile reference on the site and in the schema: ${sample([...inSchema, ...links])}.` });
  return findings;
}
