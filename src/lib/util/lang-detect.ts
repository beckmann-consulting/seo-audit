// ultimate-41: a small language guess from function words, without a dependency (journal ultimate-41-plan.md 1.4).
// It answers only when the evidence is clear and says nothing otherwise; no answer means no finding.
//
// Only words that stand in exactly one of the six lists count ("exclusive" words): "in", "an", "am", "so", "de",
// "die", "la" and the like belong to several languages and would blur short texts.
//  - long texts (30 words and more): at least 8 exclusive hits, the leading language at least 60 % of them;
//  - short texts (5 to 29 words): at least 2 exclusive hits, all of one language;
//  - under 5 words: no answer.

export type DetectedLang = 'de' | 'en' | 'fr' | 'es' | 'it' | 'nl';

export interface LangGuess {
  lang: DetectedLang;
  confidence: number; // share of the leading language among the exclusive hits
  hits: number; // exclusive hits of the leading language
  method: 'long' | 'short';
}

const WORDS: Record<DetectedLang, string> = {
  de: 'der die das und ist nicht mit für auf ein eine einen einem einer den dem des von zu im am an in sich auch es wir sie ich er wird werden sind war wie oder aber wenn nur noch bei nach aus über unter durch um so dass kann können haben hat ihre ihr unsere unser sowie mehr keine zum zur',
  en: 'the and is are was were be been of to in for on with as at by from that this these those it its an a or but not we you your our they their he she his her have has had will would can could which who what when how all more about into than then so am do does',
  fr: 'le la les de des du un une et est sont en dans pour sur avec par au aux ce cette ces qui que ne pas plus nous vous ils elle il son sa ses leur mais ou comme été être avoir très sans tout tous se si notre votre je a ont était',
  es: 'el la los las de del y en un una unos es son por para con que se no su sus al lo como más pero este esta estos también muy sin sobre entre ya hay ha han fue ser nos nuestro nuestra nuestros nuestras le les o cuando donde todo todos mi usted ustedes está están tiene tienen puede pueden desde hasta porque cada esto',
  it: 'il lo la gli le di del della dei delle e è un una uno in per con che non si da dal dalla al alla sono come più ma anche questo questa nel nella sul sulla ci ha hanno essere tutto tutti o se noi voi loro suo sua nostro nostra',
  nl: 'de het een en van in is op te dat die voor met zijn niet aan er ook als bij door om uit naar maar of wordt worden kan kunnen wij we u jij je hij zij ze ons onze uw deze dit wat hoe meer nog al geen zo over tot',
};

const LANGS = Object.keys(WORDS) as DetectedLang[];

/** word → its only language; words of two or more lists are left out. */
export const EXCLUSIVE: ReadonlyMap<string, DetectedLang> = (() => {
  const seen = new Map<string, DetectedLang | null>();
  for (const lang of LANGS) {
    for (const w of new Set(WORDS[lang].split(' '))) {
      seen.set(w, seen.has(w) && seen.get(w) !== lang ? null : lang);
    }
  }
  const out = new Map<string, DetectedLang>();
  for (const [w, l] of seen) if (l) out.set(w, l);
  return out;
})();

export const SHORT_MIN_WORDS = 5;
export const LONG_MIN_WORDS = 30;
const LONG_MIN_HITS = 8;
const LONG_MIN_SHARE = 0.6;
const SHORT_MIN_HITS = 2;

export function words(text: string): string[] {
  return text.normalize('NFKC').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
}

export function detectLanguage(text: string): LangGuess | undefined {
  const tokens = words(text);
  if (tokens.length < SHORT_MIN_WORDS) return undefined;
  const counts = new Map<DetectedLang, number>();
  for (const t of tokens) {
    const l = EXCLUSIVE.get(t);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return undefined;
  const [lang, hits] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const confidence = hits / total;
  if (tokens.length >= LONG_MIN_WORDS) {
    if (total < LONG_MIN_HITS || confidence < LONG_MIN_SHARE) return undefined;
    return { lang, confidence, hits, method: 'long' };
  }
  if (hits < SHORT_MIN_HITS || counts.size !== 1) return undefined;
  return { lang, confidence, hits, method: 'short' };
}

/** The primary subtag of a language code (`de-AT` → `de`), lower case; undefined for empty or `x-default`. */
export function primaryLang(code: string | undefined | null): string | undefined {
  if (!code) return undefined;
  const p = code.trim().toLowerCase().split(/[-_]/)[0];
  return p && p !== 'x' ? p : undefined;
}
