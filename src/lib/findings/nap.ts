// ultimate-41, point 10 (journal ultimate-41-plan.md section 5): name, address and phone (NAP) from JSON-LD, the
// imprint and the footer of the start page, compared after normalising. The imprint text and the footer are read from
// the crawled HTML during the analysis only. The heuristics read German style addresses (postcode before the town,
// street names ending in -straße, -weg, -platz ...); where a source gives nothing, it only appears in the check log.
//
// Codex, review of 32e99e2094 (finding 1): the town (addressLocality) and the names are compared per source too, and
// national numbers get the country code of the address (addressCountry) or of the start page's language; where neither
// tells, a national number matches an international one that ends in it.
import { parse, type Node } from 'node-html-parser';
import type { Finding, PageSEOData } from '@/types';
import { id } from './utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { detectLegalPages } from '@/lib/util/legal-page-detection';
import { schemaTableType } from '@/lib/schema-fields';
import type { CheckLog } from '@/lib/checks/check-log';

export interface Nap { phones: Set<string>; postcodes: Set<string>; localities: Set<string>; streets: Set<string>; names: Set<string> }
const empty = (): Nap => ({ phones: new Set(), postcodes: new Set(), localities: new Set(), streets: new Set(), names: new Set() });
const hasData = (n: Nap) => n.phones.size + n.postcodes.size + n.localities.size + n.streets.size > 0;

/** How national numbers and postcodes read: the country calling code and the postcode length. */
export interface NapCountry { iso?: string; code?: string; zipDigits: 4 | 5; source?: string }

const CALLING: Record<string, string> = {
  de: '49', at: '43', ch: '41', li: '423', lu: '352', be: '32', nl: '31', fr: '33', es: '34', it: '39', pt: '351', gb: '44', uk: '44',
  ie: '353', us: '1', ca: '1', dk: '45', se: '46', no: '47', fi: '358', pl: '48', cz: '420',
};
const COUNTRY_NAMES: Record<string, string> = {
  deutschland: 'de', germany: 'de', deu: 'de', österreich: 'at', austria: 'at', aut: 'at', schweiz: 'ch', switzerland: 'ch', suisse: 'ch',
  svizzera: 'ch', che: 'ch', liechtenstein: 'li', luxemburg: 'lu', luxembourg: 'lu', belgien: 'be', belgium: 'be', belgique: 'be',
  niederlande: 'nl', netherlands: 'nl', nederland: 'nl', frankreich: 'fr', france: 'fr', spanien: 'es', spain: 'es', españa: 'es',
  italien: 'it', italy: 'it', italia: 'it', 'united kingdom': 'gb', großbritannien: 'gb', irland: 'ie', ireland: 'ie',
  'united states': 'us', usa: 'us',
};
// a language alone, where it stands for one country in practice (English does not)
const LANG_COUNTRY: Record<string, string> = { de: 'de', fr: 'fr', es: 'es', it: 'it', nl: 'nl', pt: 'pt', da: 'dk', sv: 'se', fi: 'fi', pl: 'pl', cs: 'cz' };
const FOUR_DIGIT_ZIP = new Set(['at', 'ch', 'li', 'lu', 'be', 'dk', 'no']);

function isoOf(raw: string): string | undefined {
  const s = raw.normalize('NFKC').trim().toLowerCase();
  if (/^[a-z]{2}$/.test(s)) return s;
  return COUNTRY_NAMES[s];
}

const isBusiness = (type: string) => { const row = schemaTableType(type); return row === 'LocalBusiness' || row === 'Organization'; };
const record = (v: unknown): Record<string, unknown> | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : undefined;

/** The country from addressCountry of a LocalBusiness or Organization, else from the start page's lang. */
export function napCountry(pages: PageSEOData[], start?: PageSEOData): NapCountry {
  const of = (iso: string | undefined, source: string): NapCountry | undefined =>
    iso && CALLING[iso] ? { iso, code: CALLING[iso], zipDigits: FOUR_DIGIT_ZIP.has(iso) ? 4 : 5, source } : undefined;
  for (const p of pages) for (const s of p.schemas) {
    if (!isBusiness(s.type)) continue;
    const c = record(s.data.address)?.addressCountry;
    const raw = typeof c === 'string' ? c : typeof record(c)?.name === 'string' ? record(c)!.name as string : undefined;
    const hit = raw ? of(isoOf(raw), `addressCountry ${raw.trim()}`) : undefined;
    if (hit) return hit;
  }
  const lang = start?.lang?.trim().toLowerCase();
  if (lang) {
    const [l, region] = lang.split(/[-_]/);
    const hit = of(region && /^[a-z]{2}$/.test(region) ? region : LANG_COUNTRY[l], `lang ${start!.lang!.trim()}`);
    if (hit) return hit;
  }
  return { zipDigits: 5 };
}

/**
 * Digits with the country code: "+49 (0)40 123" → "4940123", "040 123" → "4940123" with code 49. Without a code a
 * national number keeps its leading 0 ("040123"); samePhone compares it with the end of international ones.
 */
export function normalisePhone(raw: string, code?: string): string | undefined {
  let s = raw.replace(/\(0\)/g, '').trim();
  const plus = s.startsWith('+') || s.startsWith('00');
  s = s.replace(/^00/, '').replace(/\D/g, '');
  if (s.length < 6) return undefined;
  if (plus) return s;
  if (s.startsWith('0')) return code ? code + s.slice(1) : s;
  return s;
}

/** Equal, or a national number of unknown country (leading 0) that an international one ends in after its code. */
export function samePhone(a: string, b: string): boolean {
  if (a === b) return true;
  const [nat, intl] = a.startsWith('0') ? [a, b] : [b, a];
  if (!nat.startsWith('0') || intl.startsWith('0')) return false;
  const cc = intl.length - (nat.length - 1);
  return cc >= 1 && cc <= 3 && intl.endsWith(nat.slice(1));
}

// a sentence mark at the end ("20095 Hamburg.", "Frankfurt (Oder).") is no part of the town, in either source (Codex, review
// of 38125c21b6)
const foldPlace = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/(?<=\S)[.:!?]+$/u, '');
// What may follow the short form of a town: "Frankfurt am Main", "Weiden in der Oberpfalz", "Neustadt a. d. Weinstraße",
// "Bad Homburg vor der Höhe". A bracket ("Frankfurt (Oder)", "Halle (Saale)") or another word ("Bad Vilbel") names
// another town (Codex, review of 8a236e0713: the prefix rule took "Frankfurt" and "Frankfurt (Oder)" for one town).
const PLACE_ADDITION = /^(?:am|an|im|in|ob|bei|vor|a\.|b\.|i\.) \S/;
/** Equal, or the longer is the shorter plus an addition like "am Main"; "Frankfurt" and "Frankfurt (Oder)" differ. */
export function samePlace(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.startsWith(short + ' ') && PLACE_ADDITION.test(long.slice(short.length + 1));
}

const STREET = /([A-ZÄÖÜ][\wäöüß.\-]*?(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee|markt|steig|pfad|hof|berg)\s*\d+\s*[a-z]?)\b/gi;
export function normaliseStreet(s: string): string {
  return s.toLowerCase().replace(/strasse|str\./g, 'straße').replace(/[\s.-]+/g, '');
}

// words that end a town on its line ("20095 Hamburg Telefon 040 …", "20095 Hamburg Deutschland")
const PLACE_STOP = new Set([
  'tel', 'telefon', 'fon', 'fax', 'phone', 'mobil', 'mobile', 'e-mail', 'email', 'mail', 'web', 'internet', 'kontakt', 'contact',
  'öffnungszeiten', 'impressum', 'datenschutz', 'anfahrt', 'route', 'ust', 'ust-id', 'ust-idnr', 'handelsregister', 'amtsgericht',
  'registergericht', 'geschäftsführer', 'geschäftsführung', 'inhaber', 'vertreten', 'steuernummer',
  'deutschland', 'germany', 'österreich', 'austria', 'schweiz', 'switzerland', 'suisse', 'svizzera', 'liechtenstein', 'luxemburg', 'luxembourg',
]);
const PLACE_JOIN = new Set(['am', 'an', 'der', 'den', 'dem', 'im', 'in', 'ob', 'bei', 'vor', 'a.', 'b.', 'd.', 'i.', 'v.']);
// an abbreviation inside a town name; any other word ending in a sentence mark ends the town ("20095 Hamburg. Wir …")
const PLACE_ABBR = new Set(['st.']);

/**
 * The town after a postcode: capitalised words, joiners like "am" or "an der" and a bracket, up to any other word, a
 * sentence mark ("Hamburg.", "(Oder).") or the close of a bracket around the address ("(Sitz: 20095 Hamburg)").
 */
export function townOf(rest: string): string | undefined {
  const words: string[] = [];
  for (const w of rest.trim().split(/[ \t]+/)) {
    const closes = !w.includes('(') && /\)[.:!?]*$/.test(w);
    const word = closes ? w.replace(/\)[.:!?]*$/, '') : w;
    const lower = word.toLowerCase();
    if (PLACE_STOP.has(lower.replace(/[.:!?]+$/, ''))) break;
    const join = PLACE_JOIN.has(lower);
    if (!join && !/^\p{Lu}[\p{L}.\-']*[:!?]*$/u.test(word) && !/^\(\p{Lu}[\p{L}.\-]*\)[.:!?]*$/u.test(word)) break;
    words.push(word);
    if (closes || words.length === 6 || (!join && /[.:!?]$/.test(word) && !PLACE_ABBR.has(lower))) break;
  }
  while (words.length > 0 && PLACE_JOIN.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.length > 0 && /^\p{Lu}\p{Ll}/u.test(words[0]) ? foldPlace(words.join(' ')) : undefined;
}

/** Phones, postcodes with their town, and streets in a text; phones only after "Tel", "Telefon", "Phone", "Fon" or "Mobil". */
export function napFromText(text: string, country: Pick<NapCountry, 'code' | 'zipDigits'> = { zipDigits: 5 }): Nap {
  const n = empty();
  for (const m of text.matchAll(/(?:tel(?:efon)?|phone|fon|mobil)\.?\s*:?\s*((?:\+|00)?[\d\s/().-]{6,}\d)/gi)) {
    const p = normalisePhone(m[1], country.code);
    if (p) n.phones.add(p);
  }
  // the rest of the line after the postcode, up to a separator; read in a lookahead, so a second address still matches
  const zip = new RegExp(String.raw`(?<![\d©])\b(\d{${country.zipDigits}})[ \t]+(?=([^\n,;·|•/–—]+))`, 'gu');
  for (const m of text.matchAll(zip)) {
    // a four-digit "postcode" right after © or "copyright" is a year
    if (/(?:©|\(c\)|copyright)\s*$/i.test(text.slice(Math.max(0, m.index! - 12), m.index))) continue;
    const town = townOf(m[2]);
    if (!town) continue;
    n.postcodes.add(m[1]);
    n.localities.add(town);
  }
  for (const m of text.matchAll(STREET)) n.streets.add(normaliseStreet(m[1]));
  return n;
}

const LEGAL_FORM = String.raw`(?:GmbH & Co\. KG|gGmbH|GmbH|UG \(haftungsbeschränkt\)|UG|AG|KG|OHG|GbR|PartG mbB|e\. ?K\.|e\. ?V\.|Ltd\.?|LLC|Inc\.?|SARL|B\.V\.|S\.r\.l\.)`;
const LEGAL_FORM_END = new RegExp(String.raw`[ \t,]*${LEGAL_FORM}$`, 'u');

/** Business names in a footer: the holder after ©, and names with a legal form (GmbH, UG, e.K. ...) on one line.
 *  Give it textNodes(), one text node per line: inline elements styled as blocks run together in structuredText. */
export function namesFromText(text: string): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    const t = s.replace(/[\s.,;:|·•–—-]+$/u, '').replace(/^[\s,;:|·•–—-]+/u, '').trim();
    if (t.length >= 2 && t.length <= 80 && /\p{L}/u.test(t) && !/^(?:alle rechte|all rights)/i.test(t)) out.add(t);
  };
  // the holder may stand in the next text node ("<span>© 2026</span><span>Name</span>")
  for (const m of text.matchAll(/(?:(?:©|\(c\)|copyright)[ \t]*)+(?:\d{4}(?:[ \t]*[-–][ \t]*\d{4})?)?\s*(?:by\s+)?([^|·•\n]+?)(?=[ \t]*(?:[|·•\n]|\.(?:[ \t]|$)|,|alle rechte|all rights|$))/giu)) add(m[1]);
  const legal = new RegExp(String.raw`((?:\p{Lu}[\p{L}\d&'.\-]*[ \t]+){1,4}${LEGAL_FORM})(?=[\s,;)|·•]|$)`, 'gu');
  for (const m of text.matchAll(legal)) add(m[1]);
  return out;
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** The name without its legal form: "Beckmann Digital GmbH" → "beckmann digital". */
const core = (s: string) => fold(s.replace(LEGAL_FORM_END, '')) || fold(s);
/** The needle as whole words: "muster" is not in "musterstr. 1". */
const hasWords = (hay: string, needle: string) =>
  needle.length > 0 && new RegExp(String.raw`(?<![\p{L}\d])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\p{L}\d])`, 'u').test(hay);
const sameName = (a: string, b: string) => { const x = core(a), y = core(b); return hasWords(x, y) || hasWords(y, x); };

/** The text nodes under the selector, one per line (\"<span>© 2026 A</span><span>B</span>\" gives two lines, not \"AB\"). */
function textNodes(html: string, selector: string): string {
  const root = parse(html);
  root.querySelectorAll('script, style, noscript').forEach(e => e.remove());
  const out: string[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === 3) { const t = n.text.replace(/\s+/g, ' ').trim(); if (t) out.push(t); } else n.childNodes.forEach(walk);
  };
  root.querySelectorAll(selector).forEach(walk);
  return out.join('\n');
}

function visibleText(html: string, selector?: string): string {
  const root = parse(html);
  root.querySelectorAll('script, style, noscript').forEach(e => e.remove());
  const scope = selector ? root.querySelectorAll(selector) : [root.querySelector('body') ?? root];
  return scope.map(e => e.structuredText ?? e.text).join('\n');
}

function telLinks(html: string, selector: string, code?: string): Set<string> {
  const out = new Set<string>();
  for (const box of parse(html).querySelectorAll(selector)) {
    for (const a of box.querySelectorAll('a[href^="tel:"]')) {
      // a malformed escape ("tel:+4940123456%ZZ") makes that number unreadable, not the audit (Prüfer, review of
      // ed5aac59bd: decodeURIComponent threw and the whole audit ended without a result)
      let raw: string;
      try { raw = decodeURIComponent((a.getAttribute('href') ?? '').slice(4)); } catch { continue; }
      const p = normalisePhone(raw, code);
      if (p) out.add(p);
    }
  }
  return out;
}

export function napFromJsonLd(pages: PageSEOData[], country: Pick<NapCountry, 'code' | 'zipDigits'> = { zipDigits: 5 }): Nap {
  const n = empty();
  for (const p of pages) for (const s of p.schemas) {
    if (!isBusiness(s.type)) continue;
    const d = s.data as Record<string, unknown>;
    for (const k of ['name', 'legalName']) if (typeof d[k] === 'string' && (d[k] as string).trim()) n.names.add((d[k] as string).trim());
    if (typeof d.telephone === 'string') { const t = normalisePhone(d.telephone, country.code); if (t) n.phones.add(t); }
    const addr = record(d.address);
    if (addr) {
      if (typeof addr.postalCode === 'string' && addr.postalCode.trim()) n.postcodes.add(addr.postalCode.trim());
      if (typeof addr.addressLocality === 'string' && addr.addressLocality.trim()) n.localities.add(foldPlace(addr.addressLocality));
      if (typeof addr.streetAddress === 'string' && addr.streetAddress.trim()) n.streets.add(normaliseStreet(addr.streetAddress.trim()));
    } else if (typeof d.address === 'string') {
      const t = napFromText(d.address, country);
      t.postcodes.forEach(x => n.postcodes.add(x));
      t.localities.forEach(x => n.localities.add(x));
      t.streets.forEach(x => n.streets.add(x));
    }
  }
  return n;
}

const FIELDS = ['phones', 'postcodes', 'localities', 'streets'] as const;
const same: Record<(typeof FIELDS)[number], (a: string, b: string) => boolean> = {
  phones: samePhone, postcodes: (a, b) => a === b, localities: samePlace, streets: (a, b) => a === b,
};
const quote = (xs: Iterable<string>) => [...xs].map(x => `"${x}"`).join('/');

export function generateNapFindings(pages: PageSEOData[], rawPages: { url: string; html: string }[], log?: CheckLog): Finding[] {
  const htmlOf = new Map(rawPages.map(r => [normaliseUrl(r.url), r.html]));
  const start = pages.find(p => p.depth === 0) ?? pages[0];
  const country = napCountry(pages, start);
  const jsonld = napFromJsonLd(pages, country);
  const allLower = rawPages.map(r => r.html).join('\n').toLowerCase();
  const imprintUrl = detectLegalPages(pages, allLower).imprint.url;
  const imprintHtml = imprintUrl ? htmlOf.get(normaliseUrl(imprintUrl)) : undefined;
  const imprintText = imprintHtml ? visibleText(imprintHtml) : '';
  const imprint = imprintHtml ? napFromText(imprintText, country) : empty();
  if (imprintHtml) telLinks(imprintHtml, 'body', country.code).forEach(p => imprint.phones.add(p));
  const startHtml = start ? htmlOf.get(normaliseUrl(start.url)) : undefined;
  const footerText = startHtml ? visibleText(startHtml, 'footer, [role="contentinfo"]') : '';
  const footer = startHtml ? napFromText(footerText, country) : empty();
  if (startHtml) telLinks(startHtml, 'footer, [role="contentinfo"]', country.code).forEach(p => footer.phones.add(p));
  if (startHtml) namesFromText(textNodes(startHtml, 'footer, [role="contentinfo"]')).forEach(x => footer.names.add(x));

  const sources: [string, Nap][] = [['JSON-LD', jsonld], ['Impressum', imprint], ['Footer', footer]];
  const withData = sources.filter(([, n]) => hasData(n));
  const gaps = sources.filter(([, n]) => !hasData(n)).map(([s]) => s);
  const mismatches: string[] = [];
  for (const field of FIELDS) {
    const given = withData.filter(([, n]) => n[field].size > 0);
    for (let i = 0; i < given.length; i++) for (let j = i + 1; j < given.length; j++) {
      const [sa, a] = given[i];
      const [sb, b] = given[j];
      if (![...a[field]].some(x => [...b[field]].some(y => same[field](x, y)))) mismatches.push(`${field}: ${sa} ${[...a[field]].join('/')} ≠ ${sb} ${[...b[field]].join('/')}`);
    }
  }
  // names: every JSON-LD name (name, legalName) and every footer name against the imprint text and each other
  const nameMismatches: string[] = [];
  const inImprint = (names: Set<string>, full: boolean) => [...names].some(x => hasWords(fold(imprintText), full ? fold(x) : core(x)));
  if (jsonld.names.size && imprintText && !inImprint(jsonld.names, true)) nameMismatches.push(`JSON-LD ${quote(jsonld.names)} ≠ Impressum`);
  if (footer.names.size && imprintText && !inImprint(footer.names, false)) nameMismatches.push(`Footer ${quote(footer.names)} ≠ Impressum`);
  if (jsonld.names.size && footer.names.size && ![...jsonld.names].some(x => [...footer.names].some(y => sameName(x, y)))) {
    nameMismatches.push(`JSON-LD ${quote(jsonld.names)} ≠ Footer ${quote(footer.names)}`);
  }

  const findings: Finding[] = [];
  if (mismatches.length > 0) findings.push({
    id: id(), code: 'seo.nap-mismatch', priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium', affectedUrl: imprintUrl ?? start?.url,
    title_de: 'Name, Adresse oder Telefon (NAP) uneinheitlich', title_en: 'Name, address or phone (NAP) inconsistent',
    description_de: `Strukturierte Daten, Impressum und Footer nennen verschiedene Werte: ${mismatches.join('; ')}.`,
    description_en: `Structured data, imprint and footer give different values: ${mismatches.join('; ')}.`,
    recommendation_de: 'Telefon, Postleitzahl, Ort und Straße überall gleich angeben; für Google zählen gleiche NAP-Angaben auf Website, Schema und Unternehmensprofil.',
    recommendation_en: 'Give phone, postcode, town and street the same everywhere; Google relies on matching NAP on the site, in the schema and in the Business Profile.',
  });
  if (nameMismatches.length > 0) findings.push({
    id: id(), code: 'seo.nap-name-mismatch', priority: 'optional', module: 'seo', effort: 'low', impact: 'low', affectedUrl: imprintUrl ?? start?.url,
    title_de: 'Firmenname in JSON-LD, Impressum und Footer uneinheitlich', title_en: 'Business name differs between JSON-LD, imprint and footer',
    description_de: `Der Name stimmt nicht überein: ${nameMismatches.join('; ')}.`, description_en: `The name does not match: ${nameMismatches.join('; ')}.`,
    recommendation_de: 'Denselben Firmennamen in Schema, Impressum und Footer verwenden.', recommendation_en: 'Use the same business name in the schema, the imprint and the footer.',
  });
  const codeNote = country.code ? `Ländervorwahl +${country.code} (aus ${country.source})` : 'Ländervorwahl nicht ableitbar, nationale Nummern mit der Endung internationaler verglichen';
  const codeNoteEn = country.code ? `country code +${country.code} (from ${country.source})` : 'country code not derivable, national numbers compared with the end of international ones';
  const seen = sources.map(([s, n]) => `${s}: ${n.phones.size} Tel., ${n.postcodes.size} PLZ, ${n.localities.size} Ort(e), ${n.streets.size} Straße(n), ${s === 'Impressum' ? (imprintText ? 'Text' : 'kein Text') : `${n.names.size} Name(n)`}`).join('; ');
  const seenEn = sources.map(([s, n]) => `${s}: ${n.phones.size} phone(s), ${n.postcodes.size} postcode(s), ${n.localities.size} town(s), ${n.streets.size} street(s), ${s === 'Impressum' ? (imprintText ? 'text' : 'no text') : `${n.names.size} name(s)`}`).join('; ');
  const gapNote = gaps.length ? ` Ohne Telefon und Adresse: ${gaps.join(', ')}.` : '';
  const gapNoteEn = gaps.length ? ` Without phone and address: ${gaps.join(', ')}.` : '';
  const inWith = withData.map(([s]) => s).join(', ');
  log?.record('nap-consistency', findings.length > 0
    ? { status: 'fail', findings, summary_de: `${seen}; ${codeNote}.${gapNote}`, summary_en: `${seenEn}; ${codeNoteEn}.${gapNoteEn}` }
    : withData.length === 0
      ? { status: 'not-applicable', summary_de: `Weder JSON-LD noch Impressum noch Footer nennen Telefon, PLZ, Ort oder Straße (${seen}).`, summary_en: `Neither JSON-LD nor imprint nor footer gives a phone, postcode, town or street (${seenEn}).` }
      : withData.length < 2
        ? { status: 'not-checkable', summary_de: `Nur eine Quelle mit Angaben (${seen}; ${codeNote}).${gapNote}`, summary_en: `Only one source with data (${seenEn}; ${codeNoteEn}).${gapNoteEn}` }
        : { status: 'pass', summary_de: `Gleich in ${inWith}: ${seen}; ${codeNote}.${gapNote}`, summary_en: `Matching in ${inWith}: ${seenEn}; ${codeNoteEn}.${gapNoteEn}` });
  return findings;
}
