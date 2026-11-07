// Check 7: trust and freshness. The exact signals of the order stay with ai:
// a visible author, a visible date, the Impressum linked from the start page.
// Where an owner module reports the same page (content: no author or date
// signal at all; legal: no Impressum at all), ai adds a shadow entry instead
// of a second finding. sameAs is check 4's; the sitemap parts (point 12) are ai's.

import { trustSignals } from '../signals';
import type { AIShadowEntry } from '../types';
import type { Module, PageSEOData, SitemapInfo } from '@/types';
import { result, finding, sample, type CheckOutput } from './common';

export const DATE_GAP_DAYS = 30;
export const SAME_LASTMOD_MIN = 5;
const ARTICLE_TYPES = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle', 'Report', 'ScholarlyArticle']);
const ARTICLE_PATH = /\/(blog|artikel|article|articles|news|magazin|magazine|ratgeber|insights|posts|beitrag|beitraege)(\/|$)/i;
const CONTENT_E_E_A_T_WORDS = 500; // content.ts: E-E-A-T signals on pages with more than 500 words

export interface TrustPage { url: string; html: string; seo: PageSEOData; lastModified?: string }
export interface TrustInput { pages: TrustPage[]; sitemap?: SitemapInfo; modules: Module[]; imprintFound: boolean }

function isArticleLike(p: TrustPage): boolean {
  let path = '';
  try { path = new URL(p.url).pathname; } catch { path = p.url; }
  return p.seo.schemas.some(s => ARTICLE_TYPES.has(s.type)) || ARTICLE_PATH.test(path);
}

function dateModifiedOf(p: TrustPage): string | undefined {
  for (const s of p.seo.schemas) {
    const v = (s.data as Record<string, unknown>)['dateModified'];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function days(a: string, b: string): number | undefined {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return undefined;
  return Math.abs(ta - tb) / 86_400_000;
}

function norm(u: string): string {
  try {
    const x = new URL(u);
    return `${x.host.replace(/^www\./, '')}${x.pathname.replace(/\/$/, '')}`;
  } catch {
    return u;
  }
}

export function checkTrust(input: TrustInput): CheckOutput {
  const { pages, sitemap, modules } = input;
  if (pages.length === 0) {
    return { findings: [], result: result('trust', 'not-checkable', 'Keine Seite zum Prüfen.', 'No page to check.') };
  }
  const findings = [];
  const shadow: AIShadowEntry[] = [];
  const details_de: string[] = [];
  const details_en: string[] = [];

  // --- visible author and date on article-like pages, with the content module as owner of "no signal at all" ---
  const articles = pages.filter(isArticleLike).map(p => ({ p, t: trustSignals(p.html) }));
  const contentPages = pages.filter(p => p.seo.wordCount > CONTENT_E_E_A_T_WORDS);
  const contentActive = modules.includes('content');
  const contentOwnsAuthor = contentActive && contentPages.length > 0 && contentPages.every(p => !p.seo.hasAuthorSignal);
  const contentOwnsDate = contentActive && contentPages.length > 0 && contentPages.every(p => !p.seo.hasDateSignal);
  const ownedByContent = (p: TrustPage, owns: boolean, signal: boolean) => owns && p.seo.wordCount > CONTENT_E_E_A_T_WORDS && !signal;
  const noAuthor = articles.filter(a => !a.t.visibleAuthor);
  const authorOurs = noAuthor.filter(a => !ownedByContent(a.p, contentOwnsAuthor, a.p.seo.hasAuthorSignal));
  if (noAuthor.length > authorOurs.length) shadow.push({ signal: 'author-any', owner: 'content', priority: 'optional' });
  if (authorOurs.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `Kein sichtbarer Autor auf ${authorOurs.length} Artikelseite(n)`,
      title_en: `No visible author on ${authorOurs.length} article page(s)`,
      description_de: `Ein Autor nur in meta oder JSON-LD sieht kein Leser; für Vertrauen und Zitierbarkeit zählt ein sichtbarer Name. Betroffen: ${sample(authorOurs.map(a => a.p.url))}`,
      description_en: `An author only in meta or JSON-LD is seen by no reader; trust and citability need a visible name. Affected: ${sample(authorOurs.map(a => a.p.url))}`,
      recommendation_de: 'Autorenzeile („von Name“) am Anfang des Artikels zeigen, passend zum author im JSON-LD.',
      recommendation_en: 'Show a byline ("by Name") at the start of the article, matching the author in the JSON-LD.',
    }));
  }
  const noDate = articles.filter(a => !a.t.visibleDate);
  const dateOurs = noDate.filter(a => !ownedByContent(a.p, contentOwnsDate, a.p.seo.hasDateSignal));
  if (noDate.length > dateOurs.length) shadow.push({ signal: 'date-any', owner: 'content', priority: 'optional' });
  if (dateOurs.length > 0) {
    findings.push(finding('optional', 'low', 'low', {
      title_de: `Kein sichtbares Datum auf ${dateOurs.length} Artikelseite(n)`,
      title_en: `No visible date on ${dateOurs.length} article page(s)`,
      description_de: `Ein Datum nur in meta oder JSON-LD sieht kein Leser. Betroffen: ${sample(dateOurs.map(a => a.p.url))}`,
      description_en: `A date only in meta or JSON-LD is seen by no reader. Affected: ${sample(dateOurs.map(a => a.p.url))}`,
      recommendation_de: 'Veröffentlichungs- und Änderungsdatum sichtbar zeigen, etwa mit <time datetime="…">.',
      recommendation_en: 'Show the publication and modification dates visibly, e.g. with <time datetime="…">.',
    }));
  }
  if (articles.length === 0) {
    details_de.push('Keine Artikelseite: Autor und Datum nicht geprüft.');
    details_en.push('No article page: author and date not checked.');
  }

  // --- contact and Impressum linked from the start page ---
  const home = trustSignals(pages[0].html);
  if (!home.contactLink) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: 'Kein Kontakt von der Startseite verlinkt',
      title_en: 'No contact linked from the start page',
      description_de: 'Weder ein Link auf eine Kontaktseite noch mailto: oder tel: auf der Startseite.',
      description_en: 'Neither a link to a contact page nor mailto: or tel: on the start page.',
      recommendation_de: 'Kontakt im Kopf oder Fuß der Seite verlinken.',
      recommendation_en: 'Link the contact in the header or footer.',
    }, pages[0].url));
  }
  if (!home.impressumLink) {
    if (modules.includes('legal') && !input.imprintFound) {
      shadow.push({ signal: 'imprint-missing', owner: 'legal', priority: 'critical' });
    } else {
      findings.push(finding('recommended', 'low', 'medium', {
        title_de: 'Impressum nicht von der Startseite verlinkt',
        title_en: 'Legal notice (Impressum) not linked from the start page',
        description_de: 'Ein Impressum, das von der Startseite aus nicht erreichbar ist, finden Leser und Crawler schwer.',
        description_en: 'A legal notice that cannot be reached from the start page is hard to find for readers and crawlers.',
        recommendation_de: 'Impressum im Fuß jeder Seite verlinken.',
        recommendation_en: 'Link the legal notice in the footer of every page.',
      }, pages[0].url));
    }
  }

  // --- sitemap: dateModified against lastmod, identical lastmod, Last-Modified (point 12) ---
  const entries = sitemap?.urls ?? [];
  if (entries.length === 0) {
    details_de.push('Keine Sitemap mit Einträgen: lastmod-Vergleiche nicht prüfbar.');
    details_en.push('No sitemap with entries: lastmod comparisons not checkable.');
  } else {
    const byUrl = new Map(entries.filter(e => e.lastmod).map(e => [norm(e.url), e.lastmod as string]));
    const gaps: string[] = [];
    const headerGaps: string[] = [];
    for (const p of pages) {
      const lastmod = byUrl.get(norm(p.seo.finalUrl || p.url));
      if (!lastmod) continue;
      const dm = dateModifiedOf(p);
      const g = dm ? days(dm, lastmod) : undefined;
      if (g !== undefined && g > DATE_GAP_DAYS) gaps.push(`${p.url} (dateModified ${dm}, lastmod ${lastmod})`);
      const lm = p.lastModified;
      const h = lm ? days(lm, lastmod) : undefined;
      if (h !== undefined && h > DATE_GAP_DAYS) headerGaps.push(`${p.url} (Last-Modified ${lm}, lastmod ${lastmod})`);
    }
    if (gaps.length > 0) {
      findings.push(finding('optional', 'low', 'low', {
        title_de: `dateModified und Sitemap-lastmod weichen auf ${gaps.length} Seite(n) um mehr als ${DATE_GAP_DAYS} Tage ab`,
        title_en: `dateModified and sitemap lastmod differ by more than ${DATE_GAP_DAYS} days on ${gaps.length} page(s)`,
        description_de: `Widersprüchliche Änderungsdaten machen die Aktualität unglaubwürdig. Beispiele: ${sample(gaps, 3)}`,
        description_en: `Contradicting modification dates make freshness unconvincing. Examples: ${sample(gaps, 3)}`,
        recommendation_de: 'dateModified und lastmod aus derselben Quelle setzen.',
        recommendation_en: 'Set dateModified and lastmod from the same source.',
      }));
    }
    const withLastmod = entries.filter(e => e.lastmod);
    const sameDay = new Set(withLastmod.map(e => (e.lastmod as string).slice(0, 10)));
    if (withLastmod.length >= SAME_LASTMOD_MIN && sameDay.size === 1) {
      findings.push(finding('recommended', 'low', 'medium', {
        title_de: `Alle ${withLastmod.length} Sitemap-Einträge haben dasselbe lastmod (${[...sameDay][0]})`,
        title_en: `All ${withLastmod.length} sitemap entries share one lastmod (${[...sameDay][0]})`,
        description_de: 'Das sieht nach dem Datum des Builds aus, nicht nach dem Änderungsdatum der Seiten; Crawler können daraus keine Aktualität lesen.',
        description_en: 'This looks like the build date, not the modification date of the pages; crawlers cannot read freshness from it.',
        recommendation_de: 'lastmod je Seite aus dem echten Änderungsdatum des Inhalts erzeugen.',
        recommendation_en: 'Generate lastmod per page from the real modification date of its content.',
      }));
    }
    if (headerGaps.length > 0) {
      findings.push(finding('optional', 'low', 'low', {
        title_de: `Last-Modified und Sitemap-lastmod weichen auf ${headerGaps.length} Seite(n) um mehr als ${DATE_GAP_DAYS} Tage ab`,
        title_en: `Last-Modified and sitemap lastmod differ by more than ${DATE_GAP_DAYS} days on ${headerGaps.length} page(s)`,
        description_de: `Beispiele: ${sample(headerGaps, 3)}`,
        description_en: `Examples: ${sample(headerGaps, 3)}`,
        recommendation_de: 'Last-Modified und lastmod aus derselben Quelle setzen.',
        recommendation_en: 'Set Last-Modified and lastmod from the same source.',
      }));
    }
    if (!pages.some(p => p.lastModified)) {
      details_de.push('Kein Last-Modified-Header: dieser Vergleich nicht prüfbar.');
      details_en.push('No Last-Modified header: this comparison not checkable.');
    }
  }
  details_de.push('sameAs auf Profile: siehe Prüfung 4.');
  details_en.push('sameAs to profiles: see check 4.');

  const failed = findings.length > 0 || shadow.length > 0;
  return {
    findings,
    result: result('trust', failed ? 'fail' : 'pass',
      failed ? `Vertrauens- oder Aktualitätssignale fehlen (${findings.length} eigene Befunde, ${shadow.length} bei anderen Modulen).` : 'Autor, Datum, Kontakt, Impressum und Änderungsdaten stimmig.',
      failed ? `Trust or freshness signals missing (${findings.length} own findings, ${shadow.length} with other modules).` : 'Author, date, contact, legal notice and modification dates consistent.',
      { details_de, details_en, shadow }),
  };
}
