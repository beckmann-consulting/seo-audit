// Check 4: structured data for answers. Types per kind of page (point 8),
// ProfessionalService, Person.sameAs, Article authors and the dateModified of
// articles are ai's. Required and recommended fields (the shared tables, with
// Service and the subtypes of LocalBusiness, point 9; Organization.sameAs among
// them), the inner structure of FAQPage and parse errors belong to seo when seo
// is active: ai then keeps a shadow entry with the priority of seo's finding
// instead of a second finding.

import { SCHEMA_REQUIRED_FIELDS, SCHEMA_RECOMMENDED, hasField, hasFieldOrEquivalent, schemaTableType, LOCAL_BUSINESS_SUBTYPES, schemaSubstructureBug, SCHEMA_SUBSTRUCTURE_BUG_DE, SCHEMA_SUBSTRUCTURE_BUG_EN } from '@/lib/schema-fields';
import type { AIShadowEntry } from '../types';
import type { Module, PageSEOData, ParsedSchema } from '@/types';
import { result, finding, sample, type CheckOutput } from './common';

const SERVICE_PATH = /\/(leistung|leistungen|service|services|angebot|angebote|offer|offers|dienstleistung|dienstleistungen)(\/|$)/i;
const SERVICE_H1 = /\b(leistung|leistungen|service|services|angebot|dienstleistung)\b/i;
const PERSON_PATH = /\/(ueber|über|ueber-mich|about|about-me|team|autor|author)(\/|-|$)/i;
const ARTICLE_TYPES = new Set(['Article', 'BlogPosting', 'NewsArticle', 'TechArticle']);
// the types this check looks at for completeness
const ANSWER_TYPES = new Set(['Organization', 'LocalBusiness', 'Person', 'Article', 'BlogPosting', 'NewsArticle', 'FAQPage', 'Service', 'WebSite']);

export interface StructuredInput { pages: PageSEOData[]; faqPages: string[]; modules: Module[] }

const isOrgLike = (t: string) => t === 'Organization' || t === 'LocalBusiness' || LOCAL_BUSINESS_SUBTYPES.has(t) || t === 'Corporation';
const pathOf = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };

export function checkStructured(input: StructuredInput): CheckOutput {
  const { pages, faqPages, modules } = input;
  if (pages.length === 0) {
    return { findings: [], result: result('structured', 'not-checkable', 'Keine Seite zum Prüfen.', 'No page to check.') };
  }
  const findings = [];
  const shadow: AIShadowEntry[] = [];
  const seoActive = modules.includes('seo');
  const home = pages[0];
  const types = (p: PageSEOData) => p.schemas.map(s => s.type);

  // --- types per kind of page (point 8) ---
  if (!types(home).some(isOrgLike)) {
    findings.push(finding('important', 'low', 'high', {
      title_de: 'Startseite ohne Organization oder LocalBusiness im JSON-LD',
      title_en: 'Start page without Organization or LocalBusiness in the JSON-LD',
      description_de: 'Ohne Organization (oder LocalBusiness) fehlt KI-Antworten die maschinenlesbare Angabe, wer hinter der Seite steht.',
      description_en: 'Without Organization (or LocalBusiness) AI answers lack the machine-readable statement of who is behind the site.',
      recommendation_de: 'Organization oder einen passenden LocalBusiness-Untertyp mit name, url, logo und sameAs auf der Startseite auszeichnen.',
      recommendation_en: 'Mark up Organization or a fitting LocalBusiness subtype with name, url, logo and sameAs on the start page.',
    }, home.url));
  }
  if (!types(home).includes('WebSite')) {
    findings.push(finding('recommended', 'low', 'low', {
      title_de: 'Startseite ohne WebSite im JSON-LD',
      title_en: 'Start page without WebSite in the JSON-LD',
      description_de: 'WebSite nennt Name und Adresse der Website als Ganzes.',
      description_en: 'WebSite names the site as a whole.',
      recommendation_de: 'WebSite mit name und url auf der Startseite ergänzen.',
      recommendation_en: 'Add WebSite with name and url on the start page.',
    }, home.url));
  }
  const missingService = pages.slice(1).filter(p => (SERVICE_PATH.test(pathOf(p.url)) || p.h1s.some(h => SERVICE_H1.test(h))) && !types(p).includes('Service'));
  if (missingService.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `Leistungsseiten ohne Service im JSON-LD: ${missingService.length}`,
      title_en: `Service pages without Service in the JSON-LD: ${missingService.length}`,
      description_de: `Service beschreibt das Angebot so, dass KI-Antworten es zuordnen können. Betroffen: ${sample(missingService.map(p => p.url))}`,
      description_en: `Service describes the offer so that AI answers can attribute it. Affected: ${sample(missingService.map(p => p.url))}`,
      recommendation_de: 'Je Leistungsseite Service mit name, provider, serviceType und areaServed auszeichnen.',
      recommendation_en: 'Mark up Service with name, provider, serviceType and areaServed on every service page.',
    }));
  }
  const missingFaq = pages.filter(p => faqPages.includes(p.url) && !types(p).includes('FAQPage'));
  if (missingFaq.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `Sichtbares FAQ ohne FAQPage im JSON-LD: ${missingFaq.length} Seite(n)`,
      title_en: `Visible FAQ without FAQPage in the JSON-LD: ${missingFaq.length} page(s)`,
      description_de: `Betroffen: ${sample(missingFaq.map(p => p.url))}`,
      description_en: `Affected: ${sample(missingFaq.map(p => p.url))}`,
      recommendation_de: 'Die sichtbaren Fragen und Antworten als FAQPage mit Question und acceptedAnswer auszeichnen.',
      recommendation_en: 'Mark up the visible questions and answers as FAQPage with Question and acceptedAnswer.',
    }));
  }
  const missingPerson = pages.slice(1).filter(p => PERSON_PATH.test(pathOf(p.url)) && !types(p).includes('Person'));
  if (missingPerson.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `Seiten über eine Person ohne Person im JSON-LD: ${missingPerson.length}`,
      title_en: `Pages about a person without Person in the JSON-LD: ${missingPerson.length}`,
      description_de: `Betroffen: ${sample(missingPerson.map(p => p.url))}`,
      description_en: `Affected: ${sample(missingPerson.map(p => p.url))}`,
      recommendation_de: 'Person mit name, jobTitle und sameAs auf die Profile auszeichnen.',
      recommendation_en: 'Mark up Person with name, jobTitle and sameAs to the profiles.',
    }));
  }
  const weakAuthors: string[] = [];
  for (const p of pages) for (const s of p.schemas) {
    if (!ARTICLE_TYPES.has(s.type)) continue;
    const a = (s.data as Record<string, unknown>).author;
    const one = Array.isArray(a) ? a[0] : a;
    // a Person with a name, as the plan, the title and the recommendation say (an Organization is no author here)
    const ok = one && typeof one === 'object' && String((one as Record<string, unknown>)['@type']) === 'Person' && hasField(one as Record<string, unknown>, 'name');
    if (!ok) weakAuthors.push(p.url);
  }
  if (weakAuthors.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `Artikel ohne Person als author: ${weakAuthors.length}`,
      title_en: `Articles without a Person as author: ${weakAuthors.length}`,
      description_de: `author ist nur ein Text oder fehlt; als Person mit name wird der Autor eindeutig. Betroffen: ${sample(weakAuthors)}`,
      description_en: `author is only text or missing; as a Person with name the author becomes unambiguous. Affected: ${sample(weakAuthors)}`,
      recommendation_de: 'author als Person mit name (und url oder sameAs) setzen.',
      recommendation_en: 'Set author as a Person with name (and url or sameAs).',
    }));
  }
  // dateModified of articles (plan, completeness): where the shared tables list it (NewsArticle), it is
  // a recommended field and seo's when active; for the other article types it is ai's
  const noDateModified: string[] = [];
  for (const p of pages) for (const s of p.schemas) {
    if (!ARTICLE_TYPES.has(s.type) || (SCHEMA_RECOMMENDED[schemaTableType(s.type)] ?? []).includes('dateModified')) continue;
    if (!hasField(s.data, 'dateModified')) noDateModified.push(p.url);
  }
  if (noDateModified.length > 0) {
    findings.push(finding('optional', 'low', 'low', {
      title_de: `Artikel ohne dateModified: ${noDateModified.length}`,
      title_en: `Articles without dateModified: ${noDateModified.length}`,
      description_de: `dateModified sagt KI-Antworten, wie aktuell ein Artikel ist. Betroffen: ${sample(noDateModified)}`,
      description_en: `dateModified tells AI answers how current an article is. Affected: ${sample(noDateModified)}`,
      recommendation_de: 'dateModified bei jeder inhaltlichen Änderung setzen, aus derselben Quelle wie lastmod in der Sitemap.',
      recommendation_en: 'Set dateModified on every change of the content, from the same source as lastmod in the sitemap.',
    }));
  }
  const professional = pages.filter(p => types(p).includes('ProfessionalService'));
  if (professional.length > 0) {
    findings.push(finding('optional', 'low', 'low', {
      title_de: 'ProfessionalService ist bei schema.org veraltet',
      title_en: 'ProfessionalService is deprecated at schema.org',
      description_de: `schema.org hat den allgemeinen Typ wegen der Verwechslung mit Service abgekündigt. Betroffen: ${sample(professional.map(p => p.url))}`,
      description_en: `schema.org deprecated the general type because it was confused with Service. Affected: ${sample(professional.map(p => p.url))}`,
      recommendation_de: 'Einen aktuellen LocalBusiness-Untertyp (etwa LegalService, AccountingService) nehmen, oder Organization plus Service.',
      recommendation_en: 'Use a current LocalBusiness subtype (such as LegalService, AccountingService), or Organization plus Service.',
    }));
  }
  const persons: { url: string; s: ParsedSchema }[] = [];
  for (const p of pages) for (const s of p.schemas) if (s.type === 'Person') persons.push({ url: p.url, s });
  const noSameAs = persons.filter(x => !hasField(x.s.data, 'sameAs'));
  if (noSameAs.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `Person ohne sameAs: ${noSameAs.length}`,
      title_en: `Person without sameAs: ${noSameAs.length}`,
      description_de: `sameAs verbindet die Person mit ihren Profilen (LinkedIn, Xing, GitHub o. ä.) und macht sie für KI-Antworten eindeutig. Betroffen: ${sample(noSameAs.map(x => x.url))}`,
      description_en: `sameAs links the person to their profiles (LinkedIn, Xing, GitHub or the like) and makes them unambiguous for AI answers. Affected: ${sample(noSameAs.map(x => x.url))}`,
      recommendation_de: 'sameAs mit den URLs der Profile ergänzen.',
      recommendation_en: 'Add sameAs with the URLs of the profiles.',
    }));
  }

  // --- completeness of the answer types against the shared tables: seo's when active ---
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];
  for (const p of pages) for (const s of p.schemas) {
    const row = schemaTableType(s.type);
    if (!ANSWER_TYPES.has(row)) continue;
    const req = (SCHEMA_REQUIRED_FIELDS[row] ?? []).filter(f => !hasField(s.data, f));
    if (req.length > 0) { missingRequired.push(`${s.type} ${req.join(', ')} (${p.url})`); continue; }
    const rec = (SCHEMA_RECOMMENDED[row] ?? []).filter(f => !hasFieldOrEquivalent(s.data, f));
    if (rec.length > 0) missingRecommended.push(`${s.type} ${rec.join(', ')} (${p.url})`);
  }
  if (missingRequired.length > 0) {
    // the shadow carries the priority of seo's finding (plan 3b): seo reports missing required fields as recommended
    if (seoActive) shadow.push({ signal: 'schema-required', owner: 'seo', priority: 'recommended' });
    else findings.push(finding('important', 'low', 'medium', {
      title_de: `Pflichtfelder fehlen in ${missingRequired.length} Schema(s) für Antworten`,
      title_en: `Required fields missing in ${missingRequired.length} answer schema(s)`,
      description_de: `Beispiele: ${sample(missingRequired, 3)}`,
      description_en: `Examples: ${sample(missingRequired, 3)}`,
      recommendation_de: 'Die fehlenden Felder ergänzen.',
      recommendation_en: 'Add the missing fields.',
    }));
  }
  if (missingRecommended.length > 0) {
    if (seoActive) shadow.push({ signal: 'schema-recommended', owner: 'seo', priority: 'optional' });
    else findings.push(finding('optional', 'low', 'low', {
      title_de: `Empfohlene Felder fehlen in ${missingRecommended.length} Schema(s) für Antworten (darunter sameAs)`,
      title_en: `Recommended fields missing in ${missingRecommended.length} answer schema(s) (sameAs among them)`,
      description_de: `Beispiele: ${sample(missingRecommended, 3)}`,
      description_en: `Examples: ${sample(missingRecommended, 3)}`,
      recommendation_de: 'Die empfohlenen Felder ergänzen, bei Organization vor allem logo und sameAs.',
      recommendation_en: 'Add the recommended fields, for Organization above all logo and sameAs.',
    }));
  }

  // inner structure of the answer types (Prüfer-211): FAQPage needs entries typed Question with a name and
  // an acceptedAnswer typed Answer with text; the rules are the SEO module's, seo reports them when active,
  // ai otherwise
  const inner: { type: string; bug: keyof typeof SCHEMA_SUBSTRUCTURE_BUG_EN; url: string }[] = [];
  for (const p of pages) for (const s of p.schemas) {
    if (!ANSWER_TYPES.has(schemaTableType(s.type))) continue;
    const bug = schemaSubstructureBug(s.type, s.data);
    if (bug) inner.push({ type: s.type, bug, url: p.url });
  }
  if (inner.length > 0) {
    if (seoActive) shadow.push({ signal: 'schema-substructure', owner: 'seo', priority: 'important' });
    else findings.push(finding('important', 'medium', 'high', {
      title_de: `Innere Struktur defekt in ${inner.length} Schema(s) für Antworten`,
      title_en: `Inner structure broken in ${inner.length} answer schema(s)`,
      description_de: `Ohne vollständige Frage-Antwort-Paare können KI-Antworten und Rich Results das Schema nicht nutzen. Beispiele: ${sample(inner.map(i => `${i.type}: ${SCHEMA_SUBSTRUCTURE_BUG_DE[i.bug]} (${i.url})`), 3)}`,
      description_en: `Without complete question and answer pairs AI answers and rich results cannot use the schema. Examples: ${sample(inner.map(i => `${i.type}: ${SCHEMA_SUBSTRUCTURE_BUG_EN[i.bug]} (${i.url})`), 3)}`,
      recommendation_de: 'mainEntity als Array, jeden Eintrag mit @type Question und name, acceptedAnswer mit @type Answer und text.',
      recommendation_en: 'mainEntity as an array, every entry with @type Question and name, acceptedAnswer with @type Answer and text.',
    }));
  }

  // broken JSON-LD blocks (Prüfer-209): seo reports them when active, ai otherwise
  const broken = pages.filter(p => p.schemaParseErrors > 0);
  if (broken.length > 0) {
    if (seoActive) shadow.push({ signal: 'schema-parse', owner: 'seo', priority: 'important' });
    else findings.push(finding('important', 'low', 'medium', {
      title_de: `JSON-LD mit Parse-Fehlern auf ${broken.length} Seite(n)`,
      title_en: `JSON-LD with parse errors on ${broken.length} page(s)`,
      description_de: `Ungültiges JSON-LD ignorieren Suchmaschinen und KI-Antworten ganz. Betroffen: ${sample(broken.map(p => p.url))}`,
      description_en: `Search engines and AI answers ignore invalid JSON-LD entirely. Affected: ${sample(broken.map(p => p.url))}`,
      recommendation_de: 'Die fehlerhaften JSON-LD-Blöcke reparieren (oft Kommas oder Anführungszeichen).',
      recommendation_en: 'Repair the broken JSON-LD blocks (often commas or quotes).',
    }));
  }

  const failed = findings.length > 0 || shadow.length > 0;
  return {
    findings,
    result: result('structured', failed ? 'fail' : 'pass',
      failed ? `Strukturierte Daten für Antworten unvollständig (${findings.length} eigene Befunde, ${shadow.length} bei seo).` : 'Strukturierte Daten für Antworten vollständig.',
      failed ? `Structured data for answers incomplete (${findings.length} own findings, ${shadow.length} with seo).` : 'Structured data for answers complete.',
      { shadow }),
  };
}
