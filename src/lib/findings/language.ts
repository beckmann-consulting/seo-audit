// ultimate-41, points 5 and 19 (journal ultimate-41-plan.md section 4): per page, <html lang>, the page's own
// hreflang code, the language of its visible text and of its JSON-LD texts; html lang on every page, og:locale and
// og:locale:alternate. The full og:locale:alternate lists are read from the crawled HTML during the analysis only.
import { parse } from 'node-html-parser';
import type { Finding, PageSEOData } from '@/types';
import { id } from './utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { detectLanguage, primaryLang, words, SHORT_MIN_WORDS, EXCLUSIVE } from '@/lib/util/lang-detect';
import type { CheckLog } from '@/lib/checks/check-log';

const KNOWN = new Set(EXCLUSIVE.values()); // the languages the guess can tell
const JSONLD_TEXT_FIELDS = ['description', 'text', 'articleBody', 'headline'];
const sample = (xs: string[]) => xs.slice(0, 5).join('; ');

/** The page's own hreflang code: the entry whose target is the page itself. */
export function ownHreflang(p: PageSEOData): string | undefined {
  const self = normaliseUrl(p.url);
  const hit = p.hreflangs.find(h => h.hreflang.toLowerCase() !== 'x-default' && normaliseUrl(h.href) === self);
  return hit?.hreflang;
}

/** Text fields of a JSON-LD object and its nested objects (not arrays of further entities beyond one level). */
function jsonLdTexts(data: Record<string, unknown>, depth = 0): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'string' && JSONLD_TEXT_FIELDS.includes(k)) out.push({ field: k, text: v });
    else if (depth < 2 && v && typeof v === 'object' && !Array.isArray(v)) out.push(...jsonLdTexts(v as Record<string, unknown>, depth + 1).map(t => ({ ...t, field: `${k}.${t.field}` })));
  }
  return out;
}

/** og:locale:alternate values of a page, complete, from its HTML. */
export function ogLocaleAlternates(html: string): string[] {
  return parse(html).querySelectorAll('meta[property="og:locale:alternate"]').map(m => (m.getAttribute('content') || '').trim()).filter(Boolean);
}

function finding(code: string, priority: Finding['priority'], t: Omit<Finding, 'id' | 'code' | 'priority' | 'module' | 'effort' | 'impact'>): Finding {
  return { id: id(), code, priority, module: 'seo', effort: 'low', impact: priority === 'recommended' ? 'medium' : 'low', ...t };
}

// `related`: the findings generated before, for the start page's own lang rule (seo.html-lang-missing in seo.ts),
// which point 19 counts too: a start page without lang is no "lang everywhere" (Codex, review of 32e99e2094)
export function generateLanguageFindings(pages: PageSEOData[], htmlByUrl: Map<string, string>, log?: CheckLog, related: Finding[] = []): Finding[] {
  const findings: Finding[] = [];

  // ---- point 5: lang, own hreflang code, language of the text and of JSON-LD ----
  const langVsHreflang: string[] = [];
  const langVsText: string[] = [];
  const jsonld: string[] = [];
  let compared = 0;
  for (const p of pages) {
    const lang = primaryLang(p.lang);
    const own = primaryLang(ownHreflang(p));
    const text = p.detectedLang?.lang;
    const pageLang = lang ?? text;
    if (lang && own) { compared++; if (lang !== own) langVsHreflang.push(`${p.url} (lang ${p.lang}, hreflang ${ownHreflang(p)})`); }
    if (lang && text && KNOWN.has(lang as never)) { compared++; if (lang !== text) langVsText.push(`${p.url} (lang ${p.lang}, text ${text})`); }
    if (pageLang && KNOWN.has(pageLang as never)) {
      for (const s of p.schemas) {
        for (const t of jsonLdTexts(s.data)) {
          if (words(t.text).length < SHORT_MIN_WORDS) continue;
          const g = detectLanguage(t.text);
          if (!g) continue;
          compared++;
          if (g.lang !== pageLang) jsonld.push(`${p.url} (${s.type}.${t.field}: ${g.lang} ≠ ${pageLang})`);
        }
      }
    }
  }
  const f5: Finding[] = [];
  if (langVsHreflang.length > 0) f5.push(finding('seo.lang-hreflang-mismatch', 'recommended', {
    affectedUrl: langVsHreflang[0].split(' ')[0],
    title_de: `<html lang> und eigener hreflang-Code passen auf ${langVsHreflang.length} Seite(n) nicht zusammen`,
    title_en: `<html lang> and the page's own hreflang code disagree on ${langVsHreflang.length} page(s)`,
    description_de: `Beispiele: ${sample(langVsHreflang)}.`, description_en: `Examples: ${sample(langVsHreflang)}.`,
    recommendation_de: 'lang-Attribut und hreflang-Eintrag jeder Seite auf dieselbe Sprache setzen.',
    recommendation_en: "Set every page's lang attribute and its hreflang entry to the same language.",
  }));
  if (langVsText.length > 0) f5.push(finding('seo.content-lang-mismatch', 'recommended', {
    affectedUrl: langVsText[0].split(' ')[0],
    title_de: `Textsprache passt auf ${langVsText.length} Seite(n) nicht zu <html lang>`,
    title_en: `Text language differs from <html lang> on ${langVsText.length} page(s)`,
    description_de: `Die Funktionswörter des sichtbaren Texts zeigen eine andere Sprache als das lang-Attribut. Beispiele: ${sample(langVsText)}.`,
    description_en: `The function words of the visible text point to another language than the lang attribute. Examples: ${sample(langVsText)}.`,
    recommendation_de: 'lang-Attribut korrigieren oder den Text in der angegebenen Sprache liefern.',
    recommendation_en: 'Correct the lang attribute or serve the text in the stated language.',
  }));
  if (jsonld.length > 0) f5.push(finding('seo.jsonld-lang-mismatch', 'recommended', {
    affectedUrl: jsonld[0].split(' ')[0],
    title_de: `JSON-LD-Text in anderer Sprache als die Seite (${jsonld.length}×)`,
    title_en: `JSON-LD text in another language than the page (${jsonld.length}×)`,
    description_de: `Strukturierte Daten beschreiben die Seite in einer anderen Sprache, z. B. eine deutsche LocalBusiness-description auf der englischen Seite. Beispiele: ${sample(jsonld)}.`,
    description_en: `Structured data describes the page in another language, e.g. a German LocalBusiness description on the English page. Examples: ${sample(jsonld)}.`,
    recommendation_de: 'JSON-LD je Sprachversion in deren Sprache ausgeben.',
    recommendation_en: 'Output JSON-LD per language version in its language.',
  }));
  findings.push(...f5);
  log?.record('language-consistency', f5.length > 0
    ? { status: 'fail', findings: f5, summary_de: `${compared} Vergleiche, ${langVsHreflang.length + langVsText.length + jsonld.length} Abweichungen.`, summary_en: `${compared} comparisons, ${langVsHreflang.length + langVsText.length + jsonld.length} mismatches.` }
    : compared > 0
      ? { status: 'pass', summary_de: `${compared} Vergleiche von lang, hreflang, Text- und JSON-LD-Sprache ohne Abweichung.`, summary_en: `${compared} comparisons of lang, hreflang, text and JSON-LD language without a mismatch.` }
      : { status: 'not-applicable', summary_de: 'Keine Seite mit lang und einer zweiten Sprachangabe.', summary_en: 'No page with lang and a second language signal.' });

  // ---- point 19: html lang on every page, og:locale, og:locale:alternate ----
  const start = pages.find(p => p.depth === 0) ?? pages[0];
  const sub = pages.filter(p => p !== start);
  const noLang = sub.filter(p => !p.lang).map(p => p.url);
  const hasOg = (p: PageSEOData) => Boolean(p.ogTitle || p.ogDescription || p.ogImage);
  const noOgLocale = sub.filter(p => hasOg(p) && !p.ogLocale).map(p => p.url);
  const ogVsLang = pages.filter(p => p.ogLocale && p.lang && primaryLang(p.ogLocale) !== primaryLang(p.lang)).map(p => `${p.url} (og:locale ${p.ogLocale}, lang ${p.lang})`);
  const altMissing: string[] = [];
  let altChecked = 0;
  for (const p of pages) {
    const own = primaryLang(p.lang) ?? primaryLang(ownHreflang(p));
    const others = [...new Set(p.hreflangs.map(h => primaryLang(h.hreflang)).filter((l): l is string => Boolean(l) && l !== own))];
    if (others.length === 0 || !hasOg(p)) continue;
    const html = htmlByUrl.get(normaliseUrl(p.url));
    if (html === undefined) continue;
    altChecked++;
    const alts = new Set(ogLocaleAlternates(html).map(a => primaryLang(a)));
    const missing = others.filter(l => !alts.has(l));
    if (missing.length > 0) altMissing.push(`${p.url} (${missing.join(', ')})`);
  }
  const f19: Finding[] = [];
  if (noLang.length > 0) f19.push(finding('seo.html-lang-missing-pages', 'recommended', {
    affectedUrl: noLang[0],
    title_de: `<html lang> fehlt auf ${noLang.length} Unterseite(n)`, title_en: `<html lang> missing on ${noLang.length} subpage(s)`,
    description_de: `Beispiele: ${sample(noLang)}.`, description_en: `Examples: ${sample(noLang)}.`,
    recommendation_de: 'Jede Seite mit einem lang-Attribut in ihrer Sprache ausliefern.', recommendation_en: 'Serve every page with a lang attribute in its language.',
  }));
  if (noOgLocale.length > 0) f19.push(finding('seo.og-locale-missing-pages', 'optional', {
    affectedUrl: noOgLocale[0],
    title_de: `og:locale fehlt auf ${noOgLocale.length} Unterseite(n) mit Open-Graph-Tags`, title_en: `og:locale missing on ${noOgLocale.length} subpage(s) with Open Graph tags`,
    description_de: `Beispiele: ${sample(noOgLocale)}.`, description_en: `Examples: ${sample(noOgLocale)}.`,
    recommendation_de: 'og:locale je Seite passend zur Sprache setzen (z. B. de_DE).', recommendation_en: 'Set og:locale per page to its language (e.g. en_GB).',
  }));
  if (altMissing.length > 0) f19.push(finding('seo.og-locale-alternate-missing', 'optional', {
    affectedUrl: altMissing[0].split(' ')[0],
    title_de: `og:locale:alternate fehlt für Sprachversionen auf ${altMissing.length} Seite(n)`, title_en: `og:locale:alternate missing for language versions on ${altMissing.length} page(s)`,
    description_de: `Die Seiten haben hreflang-Alternativen in diesen Sprachen, aber kein passendes og:locale:alternate: ${sample(altMissing)}.`,
    description_en: `The pages have hreflang alternates in these languages but no matching og:locale:alternate: ${sample(altMissing)}.`,
    recommendation_de: 'Für jede Sprachversion ein og:locale:alternate angeben.', recommendation_en: 'Add an og:locale:alternate for every language version.',
  }));
  if (ogVsLang.length > 0) f19.push(finding('seo.og-locale-lang-mismatch', 'optional', {
    affectedUrl: ogVsLang[0].split(' ')[0],
    title_de: `og:locale passt auf ${ogVsLang.length} Seite(n) nicht zu <html lang>`, title_en: `og:locale differs from <html lang> on ${ogVsLang.length} page(s)`,
    description_de: `Beispiele: ${sample(ogVsLang)}.`, description_en: `Examples: ${sample(ogVsLang)}.`,
    recommendation_de: 'og:locale und lang aus derselben Sprachangabe erzeugen.', recommendation_en: 'Generate og:locale and lang from the same language setting.',
  }));
  findings.push(...f19);
  // the status follows what was checked on every page, the start page included
  const startNoLang = Boolean(start && !start.lang);
  const startFinding = startNoLang ? related.filter(f => f.code === 'seo.html-lang-missing') : [];
  const logFindings = [...f19, ...startFinding];
  const problems = noLang.length + (startNoLang ? 1 : 0) + noOgLocale.length + altMissing.length + ogVsLang.length;
  log?.record('lang-and-og-locale', problems === 0
    ? { status: 'pass', summary_de: `${pages.length} Seiten: lang überall, og:locale passend, og:locale:alternate auf ${altChecked} Seite(n) mit Sprachversionen vollständig.`, summary_en: `${pages.length} pages: lang everywhere, og:locale matching, og:locale:alternate complete on ${altChecked} page(s) with language versions.` }
    : logFindings.length > 0
      ? { status: 'fail', findings: logFindings, summary_de: `${pages.length} Seiten geprüft; ohne lang: ${noLang.length + (startNoLang ? 1 : 0)}${startNoLang ? ' (darunter die Startseite)' : ''}; ${logFindings.length} Befund(e).`, summary_en: `${pages.length} pages checked; without lang: ${noLang.length + (startNoLang ? 1 : 0)}${startNoLang ? ' (the start page among them)' : ''}; ${logFindings.length} finding(s).` }
      : { status: 'not-checkable', summary_de: 'Die Startseite hat kein lang, aber ihr Befund fehlt.', summary_en: 'The start page has no lang, but its finding is missing.' });
  return findings;
}
