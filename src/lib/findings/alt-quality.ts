// ultimate-41, point 20 (journal ultimate-41-plan.md section 5): alt texts by content: a file name as alt, too long,
// in another language than the page. The alt values are read from the crawled HTML during the analysis only, at most
// ALT_CAP of them per audit. Past the cap, findings about images that were read still stand (each named image is a
// concrete case), but the point is never passed.
import { parse } from 'node-html-parser';
import type { Finding, PageSEOData } from '@/types';
import { id } from './utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { detectLanguage, primaryLang, words, SHORT_MIN_WORDS } from '@/lib/util/lang-detect';
import type { CheckLog } from '@/lib/checks/check-log';

export const ALT_CAP = 5000;
export const ALT_MAX_CHARS = 150;

export interface AltImage { pageUrl: string; src: string; alt: string }

/** Images with a non-empty alt, in page order; alt="" marks a decorative image and is not judged. */
export function collectAlts(pages: { url: string; html: string }[], cap: number = ALT_CAP): { images: AltImage[]; truncated: boolean } {
  const images: AltImage[] = [];
  for (const p of pages) {
    for (const img of parse(p.html).querySelectorAll('img[alt]')) {
      const alt = (img.getAttribute('alt') ?? '').trim();
      if (!alt) continue;
      if (images.length >= cap) return { images, truncated: true };
      images.push({ pageUrl: p.url, src: img.getAttribute('src') ?? '', alt });
    }
  }
  return { images, truncated: false };
}

const EXTENSION = /\.(jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic)\b/i;
const CAMERA = /^(img|dsc|dscn|dscf|dcim|pxl|mvimg|photo|image|bild|screenshot|whatsapp image)[\s_-]*\d{2,}/i;

function plain(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[_\-.+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The alt is the file name (with or without extension), contains an image file extension, or a camera numbering. */
export function altLooksLikeFileName(alt: string, src: string): boolean {
  if (EXTENSION.test(alt) || CAMERA.test(alt.trim())) return true;
  let base = '';
  try { base = decodeURIComponent(new URL(src, 'https://x.invalid/').pathname.split('/').pop() ?? ''); } catch { base = src.split('/').pop() ?? ''; }
  const stem = base.replace(/\.[a-z0-9]{2,5}$/i, '');
  return stem.length > 0 && plain(stem) === plain(alt);
}

export function generateAltQualityFindings(pages: PageSEOData[], rawPages: { url: string; html: string }[], log?: CheckLog, cap: number = ALT_CAP): Finding[] {
  const { images, truncated } = collectAlts(rawPages, cap);
  const langOf = new Map(pages.map(p => [normaliseUrl(p.url), primaryLang(p.lang) ?? p.detectedLang?.lang]));
  const fileName: string[] = [];
  const tooLong: string[] = [];
  const language: string[] = [];
  for (const im of images) {
    const where = `${im.pageUrl}: "${im.alt.slice(0, 60)}${im.alt.length > 60 ? '…' : ''}"`;
    if (altLooksLikeFileName(im.alt, im.src)) fileName.push(where);
    if (im.alt.length > ALT_MAX_CHARS) tooLong.push(`${im.pageUrl} (${im.alt.length} ${im.alt.length === 1 ? 'char' : 'chars'})`);
    const pageLang = langOf.get(normaliseUrl(im.pageUrl));
    if (pageLang && words(im.alt).length >= SHORT_MIN_WORDS) {
      const g = detectLanguage(im.alt);
      if (g && g.lang !== pageLang) language.push(`${where} (${g.lang} ≠ ${pageLang})`);
    }
  }
  const sample = (xs: string[]) => xs.slice(0, 5).join('; ') + (xs.length > 5 ? ` (+${xs.length - 5})` : '');
  const findings: Finding[] = [];
  if (fileName.length > 0) findings.push({
    id: id(), code: 'content.alt-filename', priority: 'recommended', module: 'content', effort: 'low', impact: 'medium',
    title_de: `${fileName.length} alt-Text(e) sind Dateinamen`, title_en: `${fileName.length} alt text(s) are file names`,
    description_de: `Der alt-Text gibt den Dateinamen, eine Bildendung oder eine Kameranummer wieder, statt das Bild zu beschreiben: ${sample(fileName)}.`,
    description_en: `The alt text repeats the file name, an image extension or a camera number instead of describing the image: ${sample(fileName)}.`,
    recommendation_de: 'Kurz beschreiben, was das Bild zeigt und wozu es auf der Seite steht.', recommendation_en: 'Describe briefly what the image shows and why it is on the page.',
  });
  if (tooLong.length > 0) findings.push({
    id: id(), code: 'content.alt-too-long', priority: 'optional', module: 'content', effort: 'low', impact: 'low',
    title_de: `${tooLong.length} alt-Text(e) länger als ${ALT_MAX_CHARS} Zeichen`, title_en: `${tooLong.length} alt text(s) longer than ${ALT_MAX_CHARS} characters`,
    description_de: `Screenreader lesen lange alt-Texte vollständig vor: ${sample(tooLong)}.`, description_en: `Screen readers read long alt texts out in full: ${sample(tooLong)}.`,
    recommendation_de: 'Auf das Wesentliche kürzen; längere Erklärungen gehören in den Text um das Bild.', recommendation_en: 'Cut to the essentials; longer explanations belong in the text around the image.',
  });
  if (language.length > 0) findings.push({
    id: id(), code: 'content.alt-language', priority: 'optional', module: 'content', effort: 'low', impact: 'low',
    title_de: `${language.length} alt-Text(e) in anderer Sprache als die Seite`, title_en: `${language.length} alt text(s) in another language than the page`,
    description_de: `Beispiele: ${sample(language)}.`, description_en: `Examples: ${sample(language)}.`,
    recommendation_de: 'alt-Texte je Sprachversion in deren Sprache schreiben.', recommendation_en: 'Write alt texts per language version in its language.',
  });
  const counts_de = `${images.length} alt-Texte geprüft${truncated ? ` (Grenze ${cap} erreicht, weitere nicht gelesen)` : ''}.`;
  const counts_en = `${images.length} alt texts checked${truncated ? ` (cap of ${cap} reached, further ones not read)` : ''}.`;
  log?.record('alt-text-quality', findings.length > 0
    ? { status: 'fail', findings, summary_de: `${counts_de} ${findings.length} Befund(e).`, summary_en: `${counts_en} ${findings.length} finding(s).` }
    : truncated
      ? { status: 'not-checkable', summary_de: counts_de, summary_en: counts_en }
      : images.length === 0
        ? { status: 'not-applicable', summary_de: 'Kein Bild mit alt-Text.', summary_en: 'No image with an alt text.' }
        : { status: 'pass', summary_de: `${counts_de} Keine Dateinamen, keine zu langen, keine in anderer Sprache.`, summary_en: `${counts_en} No file names, none too long, none in another language.` });
  return findings;
}
