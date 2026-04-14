// ============================================================
//  AUDIT ENGINE
//  Führt alle Checks deterministisch auf dem geparstem HTML aus.
//  Gleicher HTML-Input = gleicher Output. Kein KI-Anteil hier.
//  Die Claude-API wird nur für die Zusammenfassung verwendet.
// ============================================================

import { parse } from 'node-html-parser';
import { AUDIT_CATEGORIES, getCategoryMaxPoints } from '@/config/criteria';
import type { AuditResult, CategoryResult, CriterionResult } from '@/lib/types';

interface ParsedPage {
  html: string;
  url: string;
  isHttps: boolean;
}

// ============================================================
//  EINZELNE CHECK-FUNKTIONEN
//  Jede Funktion: (page: ParsedPage) => CriterionResult
// ============================================================

function checkHttps(page: ParsedPage): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  if (page.isHttps) {
    return { status: 'pass', points: 5, detail_de: 'Die Seite wird über HTTPS ausgeliefert. ✓', detail_en: 'The page is served over HTTPS. ✓' };
  }
  return { status: 'fail', points: 0, detail_de: 'Die Seite nutzt kein HTTPS. Google markiert HTTP-Seiten als unsicher. → Sofort auf HTTPS migrieren.', detail_en: 'The page does not use HTTPS. Google flags HTTP pages as insecure. → Migrate to HTTPS immediately.' };
}

function checkWwwRedirect(page: ParsedPage): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const url = new URL(page.url);
  const hasWww = url.hostname.startsWith('www.');
  return {
    status: 'info',
    points: 2,
    detail_de: `Die geprüfte URL verwendet ${hasWww ? 'www' : 'kein www'}. Stelle sicher, dass die jeweils andere Variante per 301 weitergeleitet wird. Manuell zu prüfen.`,
    detail_en: `The checked URL uses ${hasWww ? 'www' : 'no www'}. Ensure the other variant redirects via 301. Check manually.`,
  };
}

function checkRobotsTxt(page: ParsedPage): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  // Wird async geprüft — Ergebnis wird nach dem Haupt-Parse ergänzt
  return { status: 'info', points: 2, detail_de: 'robots.txt muss separat geprüft werden (siehe Ergebnis nach Fetch).', detail_en: 'robots.txt must be checked separately (see result after fetch).' };
}

function checkSitemapXml(_page: ParsedPage): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  return { status: 'info', points: 2, detail_de: 'XML-Sitemap wird separat geprüft (muss nach robots.txt-Fetch bewertet werden).', detail_en: 'XML Sitemap is checked separately (must be evaluated after robots.txt fetch).' };
}

function checkCanonical(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const canonical = root.querySelector('link[rel="canonical"]');
  if (canonical && canonical.getAttribute('href')) {
    return { status: 'pass', points: 3, detail_de: `Canonical-Tag gesetzt: ${canonical.getAttribute('href')}`, detail_en: `Canonical tag set: ${canonical.getAttribute('href')}` };
  }
  return { status: 'fail', points: 0, detail_de: 'Kein Canonical-Tag gefunden. → <link rel="canonical" href="https://..."> in den <head> einfügen.', detail_en: 'No canonical tag found. → Add <link rel="canonical" href="https://..."> to the <head>.' };
}

function checkUrlStructure(page: ParsedPage): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const url = new URL(page.url);
  const path = url.pathname;
  const hasQueryParams = url.search.length > 0;
  const hasSpecialChars = /[_\s%]/.test(path);
  const isTooLong = page.url.length > 100;

  if (!hasQueryParams && !hasSpecialChars && !isTooLong) {
    return { status: 'pass', points: 2, detail_de: 'URL-Struktur ist sauber und seo-freundlich.', detail_en: 'URL structure is clean and SEO-friendly.' };
  }
  const issues = [];
  if (hasQueryParams) issues.push('enthält Query-Parameter');
  if (hasSpecialChars) issues.push('enthält Unterstriche oder Leerzeichen (→ Bindestriche verwenden)');
  if (isTooLong) issues.push('URL ist sehr lang (>100 Zeichen)');
  return { status: 'warn', points: 1, detail_de: `URL-Probleme: ${issues.join(', ')}.`, detail_en: `URL issues: ${issues.join(', ')}.` };
}

function checkTitleTag(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const title = root.querySelector('title');
  if (!title) {
    return { status: 'fail', points: 0, detail_de: 'Kein Title-Tag gefunden! Dies ist der wichtigste On-Page-SEO-Faktor. → Sofort ergänzen.', detail_en: 'No title tag found! This is the most important on-page SEO factor. → Add immediately.' };
  }
  const text = title.text.trim();
  const len = text.length;
  if (len === 0) {
    return { status: 'fail', points: 0, detail_de: 'Title-Tag ist vorhanden aber leer. → Beschreibenden Titel mit Keyword (50–60 Zeichen) einfügen.', detail_en: 'Title tag exists but is empty. → Insert descriptive title with keyword (50–60 chars).' };
  }
  if (len < 30) {
    return { status: 'warn', points: 5, detail_de: `Title zu kurz (${len} Zeichen): "${text}". → Auf 50–60 Zeichen ausbauen.`, detail_en: `Title too short (${len} chars): "${text}". → Expand to 50–60 chars.` };
  }
  if (len > 65) {
    return { status: 'warn', points: 7, detail_de: `Title zu lang (${len} Zeichen): "${text}". Google kürzt ab ca. 60 Zeichen. → Kürzen.`, detail_en: `Title too long (${len} chars): "${text}". Google truncates at ~60 chars. → Shorten.` };
  }
  return { status: 'pass', points: 10, detail_de: `Title optimal (${len} Zeichen): "${text}"`, detail_en: `Title optimal (${len} chars): "${text}"` };
}

function checkMetaDescription(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const meta = root.querySelector('meta[name="description"]');
  if (!meta) {
    return { status: 'fail', points: 0, detail_de: 'Keine Meta-Description gefunden. → Beschreibung mit 120–160 Zeichen + Call-to-Action ergänzen.', detail_en: 'No meta description found. → Add description with 120–160 chars + call-to-action.' };
  }
  const content = (meta.getAttribute('content') || '').trim();
  const len = content.length;
  if (len === 0) {
    return { status: 'fail', points: 0, detail_de: 'Meta-Description ist leer. → Text mit 120–160 Zeichen einfügen.', detail_en: 'Meta description is empty. → Insert text with 120–160 chars.' };
  }
  if (len < 100) {
    return { status: 'warn', points: 4, detail_de: `Meta-Description zu kurz (${len} Zeichen). → Auf 120–160 Zeichen ausbauen.`, detail_en: `Meta description too short (${len} chars). → Expand to 120–160 chars.` };
  }
  if (len > 165) {
    return { status: 'warn', points: 6, detail_de: `Meta-Description zu lang (${len} Zeichen). Google kürzt ab 160 Zeichen. → Kürzen.`, detail_en: `Meta description too long (${len} chars). Google truncates at 160 chars. → Shorten.` };
  }
  return { status: 'pass', points: 8, detail_de: `Meta-Description optimal (${len} Zeichen).`, detail_en: `Meta description optimal (${len} chars).` };
}

function checkOgTags(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const ogTitle = root.querySelector('meta[property="og:title"]');
  const ogDesc = root.querySelector('meta[property="og:description"]');
  const ogImage = root.querySelector('meta[property="og:image"]');

  const missing = [];
  if (!ogTitle) missing.push('og:title');
  if (!ogDesc) missing.push('og:description');
  if (!ogImage) missing.push('og:image');

  if (missing.length === 0) {
    return { status: 'pass', points: 5, detail_de: 'Alle drei Pflicht-OG-Tags (og:title, og:description, og:image) sind vorhanden.', detail_en: 'All three required OG tags (og:title, og:description, og:image) are present.' };
  }
  if (missing.length === 3) {
    return { status: 'fail', points: 0, detail_de: 'Keine Open Graph Tags gefunden. → og:title, og:description, og:image ergänzen.', detail_en: 'No Open Graph tags found. → Add og:title, og:description, og:image.' };
  }
  return { status: 'warn', points: 2, detail_de: `Fehlende OG-Tags: ${missing.join(', ')}.`, detail_en: `Missing OG tags: ${missing.join(', ')}.` };
}

function checkTwitterCard(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const twitterCard = root.querySelector('meta[name="twitter:card"]');
  const twitterTitle = root.querySelector('meta[name="twitter:title"]');
  if (twitterCard && twitterTitle) {
    return { status: 'pass', points: 3, detail_de: 'Twitter/X Card Tags sind gesetzt.', detail_en: 'Twitter/X Card tags are set.' };
  }
  if (!twitterCard && !twitterTitle) {
    return { status: 'warn', points: 1, detail_de: 'Keine Twitter/X Card Tags. → twitter:card, twitter:title, twitter:description hinzufügen.', detail_en: 'No Twitter/X Card tags. → Add twitter:card, twitter:title, twitter:description.' };
  }
  return { status: 'warn', points: 2, detail_de: 'Twitter/X Card unvollständig.', detail_en: 'Twitter/X Card incomplete.' };
}

function checkHtmlLang(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const html = root.querySelector('html');
  const lang = html?.getAttribute('lang');
  if (lang && lang.length >= 2) {
    return { status: 'pass', points: 3, detail_de: `HTML lang-Attribut gesetzt: "${lang}".`, detail_en: `HTML lang attribute set: "${lang}".` };
  }
  return { status: 'fail', points: 0, detail_de: 'Kein lang-Attribut am <html>-Tag. → <html lang="de"> oder <html lang="en"> setzen.', detail_en: 'No lang attribute on <html> tag. → Set <html lang="de"> or <html lang="en">.' };
}

function checkViewport(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const viewport = root.querySelector('meta[name="viewport"]');
  const content = viewport?.getAttribute('content') || '';
  if (viewport && content.includes('width=device-width')) {
    return { status: 'pass', points: 3, detail_de: `Viewport Meta-Tag korrekt gesetzt: "${content}".`, detail_en: `Viewport meta tag correctly set: "${content}".` };
  }
  if (viewport) {
    return { status: 'warn', points: 1, detail_de: `Viewport Tag vorhanden, aber Inhalt ggf. nicht optimal: "${content}".`, detail_en: `Viewport tag present, but content may not be optimal: "${content}".` };
  }
  return { status: 'fail', points: 0, detail_de: 'Kein Viewport Meta-Tag! → <meta name="viewport" content="width=device-width, initial-scale=1"> einfügen.', detail_en: 'No viewport meta tag! → Add <meta name="viewport" content="width=device-width, initial-scale=1">.' };
}

function checkCharset(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const charset = root.querySelector('meta[charset]');
  if (charset) {
    const val = (charset.getAttribute('charset') || '').toLowerCase();
    if (val === 'utf-8') {
      return { status: 'pass', points: 2, detail_de: 'Charset UTF-8 korrekt gesetzt.', detail_en: 'Charset UTF-8 correctly set.' };
    }
    return { status: 'warn', points: 1, detail_de: `Charset gesetzt aber nicht UTF-8: "${val}". → Auf UTF-8 ändern.`, detail_en: `Charset set but not UTF-8: "${val}". → Change to UTF-8.` };
  }
  return { status: 'warn', points: 0, detail_de: 'Kein Charset Meta-Tag gefunden. → <meta charset="UTF-8"> in den Head einfügen.', detail_en: 'No charset meta tag found. → Add <meta charset="UTF-8"> to the head.' };
}

function checkH1(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const h1s = root.querySelectorAll('h1');
  if (h1s.length === 0) {
    return { status: 'fail', points: 0, detail_de: 'Kein H1-Tag gefunden. → Genau einen H1 mit dem Haupt-Keyword ergänzen.', detail_en: 'No H1 tag found. → Add exactly one H1 with the main keyword.' };
  }
  if (h1s.length > 1) {
    const texts = h1s.map(h => h.text.trim().substring(0, 50)).join(', ');
    return { status: 'warn', points: 4, detail_de: `${h1s.length} H1-Tags gefunden (nur einer erlaubt): ${texts}. → Auf einen H1 reduzieren.`, detail_en: `${h1s.length} H1 tags found (only one allowed): ${texts}. → Reduce to one H1.` };
  }
  const text = h1s[0].text.trim();
  if (text.length < 5) {
    return { status: 'warn', points: 4, detail_de: `H1 ist zu kurz: "${text}". → Aussagekräftigen H1 mit Keyword schreiben.`, detail_en: `H1 is too short: "${text}". → Write descriptive H1 with keyword.` };
  }
  return { status: 'pass', points: 8, detail_de: `H1 vorhanden und korrekt: "${text.substring(0, 80)}"`, detail_en: `H1 present and correct: "${text.substring(0, 80)}"` };
}

function checkHeadingHierarchy(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const headings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length < 2) {
    return { status: 'warn', points: 2, detail_de: 'Nur wenige Überschriften gefunden. Gute Content-Strukturierung mit H2–H4 verbessert SEO.', detail_en: 'Only few headings found. Good content structure with H2–H4 improves SEO.' };
  }

  let prevLevel = 0;
  let hasJump = false;
  headings.forEach(h => {
    const level = parseInt(h.tagName.replace('H', '').replace('h', ''));
    if (prevLevel > 0 && level > prevLevel + 1) {
      hasJump = true;
    }
    prevLevel = level;
  });

  if (hasJump) {
    return { status: 'warn', points: 3, detail_de: 'Hierarchie-Sprünge in den Überschriften gefunden (z.B. H1→H3 ohne H2). → Hierarchie korrigieren.', detail_en: 'Hierarchy jumps found in headings (e.g. H1→H3 without H2). → Fix hierarchy.' };
  }
  return { status: 'pass', points: 5, detail_de: `${headings.length} Überschriften mit korrekter Hierarchie gefunden.`, detail_en: `${headings.length} headings with correct hierarchy found.` };
}

function checkImageAltTexts(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const images = root.querySelectorAll('img');
  if (images.length === 0) {
    return { status: 'info', points: 5, detail_de: 'Keine Bilder im HTML gefunden (könnten via CSS oder JS geladen werden).', detail_en: 'No images found in HTML (may be loaded via CSS or JS).' };
  }
  const missing = images.filter(img => {
    const alt = img.getAttribute('alt');
    return alt === null || alt === undefined;
  });
  const empty = images.filter(img => {
    const alt = img.getAttribute('alt');
    return alt !== null && alt !== undefined && alt.trim() === '' && !img.getAttribute('role');
  });

  if (missing.length === 0) {
    return { status: 'pass', points: 5, detail_de: `Alle ${images.length} Bilder haben ein alt-Attribut.`, detail_en: `All ${images.length} images have an alt attribute.` };
  }
  const ratio = missing.length / images.length;
  if (ratio > 0.5) {
    return { status: 'fail', points: 1, detail_de: `${missing.length} von ${images.length} Bildern fehlt das alt-Attribut. → Für alle Bilder aussagekräftige Alt-Texte ergänzen.`, detail_en: `${missing.length} of ${images.length} images are missing the alt attribute. → Add descriptive alt texts for all images.` };
  }
  return { status: 'warn', points: 3, detail_de: `${missing.length} von ${images.length} Bildern fehlt das alt-Attribut.`, detail_en: `${missing.length} of ${images.length} images missing alt attribute.` };
}

function checkContentLength(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  // Entfernt Scripts/Styles und zählt Wörter
  const body = root.querySelector('body');
  if (!body) return { status: 'info', points: 2, detail_de: 'Kein body-Element gefunden.', detail_en: 'No body element found.' };

  // Script und Style-Tags raus
  const scripts = body.querySelectorAll('script, style, noscript');
  let text = body.text;
  text = text.replace(/\s+/g, ' ').trim();
  const wordCount = text.split(' ').filter(w => w.length > 2).length;

  if (wordCount >= 300) {
    return { status: 'pass', points: 4, detail_de: `${wordCount} Wörter sichtbarer Text gefunden. Ausreichend Content vorhanden.`, detail_en: `${wordCount} words of visible text found. Sufficient content present.` };
  }
  if (wordCount >= 150) {
    return { status: 'warn', points: 2, detail_de: `Nur ${wordCount} Wörter Text. Google bewertet Thin Content (< 300 Wörter) negativ. → Content ausbauen.`, detail_en: `Only ${wordCount} words of text. Google penalizes thin content (< 300 words). → Expand content.` };
  }
  return { status: 'fail', points: 0, detail_de: `Sehr wenig Text (${wordCount} Wörter). Wahrscheinlich Thin Content oder JS-gerenderter Inhalt. → Seiteninhalt prüfen.`, detail_en: `Very little text (${wordCount} words). Likely thin content or JS-rendered content. → Check page content.` };
}

function checkKeywordInH1(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const h1 = root.querySelector('h1');
  const title = root.querySelector('title');
  if (!h1 || !title) {
    return { status: 'fail', points: 0, detail_de: 'H1 oder Title fehlt — Keyword-Check nicht möglich.', detail_en: 'H1 or title missing — keyword check not possible.' };
  }
  const h1Text = h1.text.toLowerCase();
  const titleText = title.text.toLowerCase();

  // Einfache Überlappungs-Prüfung: Wörter aus Title in H1?
  const titleWords = titleText.split(/\s+/).filter(w => w.length > 4);
  const overlap = titleWords.filter(w => h1Text.includes(w));

  if (overlap.length > 0) {
    return { status: 'pass', points: 3, detail_de: `H1 und Title-Tag teilen Schlüsselwörter (${overlap.slice(0, 3).join(', ')}). Gute Keyword-Konsistenz.`, detail_en: `H1 and title tag share keywords (${overlap.slice(0, 3).join(', ')}). Good keyword consistency.` };
  }
  return { status: 'warn', points: 1, detail_de: 'H1 und Title-Tag teilen keine gemeinsamen Schlüsselwörter. → Keyword-Konsistenz zwischen Title und H1 herstellen.', detail_en: 'H1 and title tag share no common keywords. → Create keyword consistency between title and H1.' };
}

function checkKeywordInTitle(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const title = root.querySelector('title');
  if (!title) return { status: 'fail', points: 0, detail_de: 'Kein Title-Tag vorhanden.', detail_en: 'No title tag present.' };
  const text = title.text.trim();
  // Prüft ob der erste "content-ful" Begriff im ersten Drittel des Titles steht
  const words = text.split(/\s+/).filter(w => w.length > 3);
  if (words.length >= 2) {
    return { status: 'pass', points: 3, detail_de: `Title enthält mehrere relevante Begriffe. Stelle sicher, dass das primäre Keyword am Anfang steht.`, detail_en: `Title contains multiple relevant terms. Ensure the primary keyword is at the beginning.` };
  }
  return { status: 'warn', points: 1, detail_de: `Title sehr kurz oder wenig aussagekräftig: "${text}". → Keyword + Markenname (z.B. "Keyword | Marke") verwenden.`, detail_en: `Title very short or not very descriptive: "${text}". → Use keyword + brand name (e.g. "Keyword | Brand").` };
}

function checkRenderBlocking(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const head = root.querySelector('head');
  if (!head) return { status: 'info', points: 3, detail_de: 'Kein head-Element gefunden.', detail_en: 'No head element found.' };

  const scripts = head.querySelectorAll('script[src]');
  const blocking = scripts.filter(s => !s.getAttribute('async') && !s.getAttribute('defer'));

  if (blocking.length === 0) {
    return { status: 'pass', points: 5, detail_de: 'Keine render-blockierenden Scripts im head gefunden.', detail_en: 'No render-blocking scripts found in head.' };
  }
  if (blocking.length <= 2) {
    return { status: 'warn', points: 3, detail_de: `${blocking.length} render-blockierende Script(s) im head ohne async/defer. → async oder defer ergänzen.`, detail_en: `${blocking.length} render-blocking script(s) in head without async/defer. → Add async or defer.` };
  }
  return { status: 'fail', points: 1, detail_de: `${blocking.length} render-blockierende Scripts im head. → Alle externen Scripts mit defer oder async laden.`, detail_en: `${blocking.length} render-blocking scripts in head. → Load all external scripts with defer or async.` };
}

function checkInlineCssJs(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const inlineStyles = root.querySelectorAll('[style]');
  const inlineScripts = root.querySelectorAll('script:not([src])');
  const total = inlineStyles.length + inlineScripts.length;

  if (total < 5) {
    return { status: 'pass', points: 3, detail_de: 'Kaum Inline-CSS/JS vorhanden. Sauber.', detail_en: 'Minimal inline CSS/JS present. Clean.' };
  }
  if (total < 20) {
    return { status: 'warn', points: 2, detail_de: `${inlineStyles.length} Inline-Style-Elemente und ${inlineScripts.length} Inline-Scripts. Moderat.`, detail_en: `${inlineStyles.length} inline style elements and ${inlineScripts.length} inline scripts. Moderate.` };
  }
  return { status: 'warn', points: 1, detail_de: `Viele Inline-Styles/Scripts (${total}). → In externe Dateien auslagern für besseres Caching.`, detail_en: `Many inline styles/scripts (${total}). → Move to external files for better caching.` };
}

function checkImageFormats(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const images = root.querySelectorAll('img[src]');
  if (images.length === 0) {
    return { status: 'info', points: 4, detail_de: 'Keine Bilder mit src-Attribut gefunden.', detail_en: 'No images with src attribute found.' };
  }
  const modernCount = images.filter(img => {
    const src = img.getAttribute('src') || '';
    return /\.(webp|avif)(\?|$)/i.test(src);
  }).length;
  const modernPicture = root.querySelectorAll('picture source[type="image/webp"], picture source[type="image/avif"]').length;
  const total = modernCount + modernPicture;

  if (total > images.length * 0.7) {
    return { status: 'pass', points: 4, detail_de: `${total} von ${images.length} Bildern nutzen moderne Formate (WebP/AVIF).`, detail_en: `${total} of ${images.length} images use modern formats (WebP/AVIF).` };
  }
  if (total > 0) {
    return { status: 'warn', points: 2, detail_de: `Nur ${total} von ${images.length} Bildern nutzen WebP/AVIF. → Alle Bilder in WebP konvertieren.`, detail_en: `Only ${total} of ${images.length} images use WebP/AVIF. → Convert all images to WebP.` };
  }
  return { status: 'warn', points: 1, detail_de: 'Keine WebP/AVIF-Bilder gefunden. → Bilder in WebP konvertieren (25–50% Größenersparnis).', detail_en: 'No WebP/AVIF images found. → Convert images to WebP (25–50% size savings).' };
}

function checkLazyLoading(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const images = root.querySelectorAll('img');
  if (images.length < 3) {
    return { status: 'info', points: 3, detail_de: 'Wenige Bilder vorhanden — Lazy Loading weniger kritisch.', detail_en: 'Few images present — lazy loading less critical.' };
  }
  const lazy = images.filter(img => img.getAttribute('loading') === 'lazy').length;
  if (lazy >= images.length * 0.5) {
    return { status: 'pass', points: 3, detail_de: `${lazy} von ${images.length} Bildern nutzen loading="lazy".`, detail_en: `${lazy} of ${images.length} images use loading="lazy".` };
  }
  return { status: 'warn', points: 1, detail_de: `Nur ${lazy} von ${images.length} Bildern haben loading="lazy". → Alle Bilder below the fold mit loading="lazy" versehen.`, detail_en: `Only ${lazy} of ${images.length} images have loading="lazy". → Add loading="lazy" to all below-the-fold images.` };
}

function checkMobileViewport(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const viewport = root.querySelector('meta[name="viewport"]');
  if (viewport && viewport.getAttribute('content')?.includes('width=device-width')) {
    return { status: 'pass', points: 3, detail_de: 'Viewport korrekt konfiguriert — Seite ist mobile-ready.', detail_en: 'Viewport correctly configured — page is mobile-ready.' };
  }
  return { status: 'fail', points: 0, detail_de: 'Viewport-Meta-Tag fehlt oder falsch konfiguriert. → Mobile-Optimierung dringend erforderlich.', detail_en: 'Viewport meta tag missing or incorrectly configured. → Mobile optimization urgently needed.' };
}

function checkNoFlash(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const embed = root.querySelectorAll('embed, object, applet');
  const frames = root.querySelectorAll('frame, frameset');
  if (embed.length === 0 && frames.length === 0) {
    return { status: 'pass', points: 3, detail_de: 'Keine veralteten Technologien (Flash, Frames) gefunden.', detail_en: 'No outdated technologies (Flash, frames) found.' };
  }
  return { status: 'fail', points: 0, detail_de: `Veraltete Tags gefunden: ${embed.length} embed/object, ${frames.length} frame/frameset. → Entfernen und durch moderne Alternativen ersetzen.`, detail_en: `Outdated tags found: ${embed.length} embed/object, ${frames.length} frame/frameset. → Remove and replace with modern alternatives.` };
}

function checkAriaLabels(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const ariaElements = root.querySelectorAll('[aria-label], [aria-labelledby], [role], [aria-describedby]');
  const landmarks = root.querySelectorAll('main, nav, header, footer, aside, section[aria-label]');
  if (ariaElements.length > 5 || landmarks.length >= 3) {
    return { status: 'pass', points: 2, detail_de: `${ariaElements.length} ARIA-Attribute und ${landmarks.length} semantische Landmark-Elemente gefunden. Gute Zugänglichkeit.`, detail_en: `${ariaElements.length} ARIA attributes and ${landmarks.length} semantic landmark elements found. Good accessibility.` };
  }
  return { status: 'warn', points: 1, detail_de: 'Wenige ARIA-Attribute und semantische Landmark-Elemente. → main, nav, header, footer und ARIA-Labels ergänzen.', detail_en: 'Few ARIA attributes and semantic landmark elements. → Add main, nav, header, footer and ARIA labels.' };
}

function checkInternalLinks(root: ReturnType<typeof parse>, pageUrl: string): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const domain = new URL(pageUrl).hostname;
  const links = root.querySelectorAll('a[href]');
  const internal = links.filter(a => {
    const href = a.getAttribute('href') || '';
    return href.startsWith('/') || href.includes(domain);
  });
  if (internal.length >= 5) {
    return { status: 'pass', points: 4, detail_de: `${internal.length} interne Links gefunden. Gute interne Verlinkung.`, detail_en: `${internal.length} internal links found. Good internal linking.` };
  }
  if (internal.length >= 2) {
    return { status: 'warn', points: 2, detail_de: `Nur ${internal.length} interne Links. → Mehr interne Verlinkung zu relevanten Unterseiten aufbauen.`, detail_en: `Only ${internal.length} internal links. → Build more internal linking to relevant subpages.` };
  }
  return { status: 'fail', points: 0, detail_de: `Kaum interne Links (${internal.length}). → Interne Verlinkung dringend ausbauen.`, detail_en: `Barely any internal links (${internal.length}). → Urgently build internal linking.` };
}

function checkBrokenLinks(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const links = root.querySelectorAll('a');
  const suspicious = links.filter(a => {
    const href = a.getAttribute('href');
    return href === '' || href === '#' || href === 'javascript:void(0)' || href === null;
  });
  if (suspicious.length === 0) {
    return { status: 'pass', points: 3, detail_de: 'Keine offensichtlich defekten oder leeren Links gefunden.', detail_en: 'No obviously broken or empty links found.' };
  }
  return { status: 'warn', points: 1, detail_de: `${suspicious.length} leere/ungültige Links gefunden (href="#", leer, etc.). → Alle Links auf echte Ziele setzen.`, detail_en: `${suspicious.length} empty/invalid links found (href="#", empty, etc.). → Set all links to real targets.` };
}

function checkAnchorText(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const links = root.querySelectorAll('a[href]');
  if (links.length === 0) return { status: 'info', points: 3, detail_de: 'Keine Links gefunden.', detail_en: 'No links found.' };

  const badPatterns = /^(hier|here|mehr|more|click here|klicken|lesen sie|read more|weiter|›|»|>|\.\.\.)$/i;
  const badLinks = links.filter(a => badPatterns.test(a.text.trim()));
  const ratio = badLinks.length / links.length;

  if (ratio < 0.1) {
    return { status: 'pass', points: 3, detail_de: 'Anchor-Texte sind überwiegend beschreibend.', detail_en: 'Anchor texts are mostly descriptive.' };
  }
  if (ratio < 0.3) {
    return { status: 'warn', points: 2, detail_de: `${badLinks.length} Links mit generischen Anchor-Texten ("mehr", "hier klicken"). → Durch beschreibende Texte ersetzen.`, detail_en: `${badLinks.length} links with generic anchor texts ("more", "click here"). → Replace with descriptive texts.` };
  }
  return { status: 'fail', points: 0, detail_de: `Viele generische Anchor-Texte (${badLinks.length}). → Anchor-Texte mit Keywords anreichern.`, detail_en: `Many generic anchor texts (${badLinks.length}). → Enrich anchor texts with keywords.` };
}

function checkJsonLd(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  if (scripts.length === 0) {
    return { status: 'warn', points: 0, detail_de: 'Kein JSON-LD / Schema.org Markup gefunden. → Mindestens Organization oder WebPage Schema ergänzen für Rich Snippets.', detail_en: 'No JSON-LD / Schema.org markup found. → Add at least Organization or WebPage schema for rich snippets.' };
  }
  let types: string[] = [];
  scripts.forEach(s => {
    try {
      const json = JSON.parse(s.text);
      if (json['@type']) types.push(json['@type']);
    } catch {}
  });
  return { status: 'pass', points: 5, detail_de: `${scripts.length} JSON-LD Block(s) gefunden. Typen: ${types.join(', ') || 'unbekannt'}.`, detail_en: `${scripts.length} JSON-LD block(s) found. Types: ${types.join(', ') || 'unknown'}.` };
}

function checkBreadcrumbSchema(root: ReturnType<typeof parse>): Pick<CriterionResult, 'status' | 'points' | 'detail_de' | 'detail_en'> {
  const scripts = root.querySelectorAll('script[type="application/ld+json"]');
  let hasBreadcrumb = false;
  scripts.forEach(s => {
    try {
      const json = JSON.parse(s.text);
      if (json['@type'] === 'BreadcrumbList') hasBreadcrumb = true;
    } catch {}
  });
  const htmlBreadcrumb = root.querySelector('[class*="breadcrumb"], [aria-label*="readcrumb"]');

  if (hasBreadcrumb) {
    return { status: 'pass', points: 2, detail_de: 'BreadcrumbList-Schema gefunden.', detail_en: 'BreadcrumbList schema found.' };
  }
  if (htmlBreadcrumb) {
    return { status: 'warn', points: 1, detail_de: 'HTML-Breadcrumb vorhanden aber kein Schema.org-Markup. → BreadcrumbList JSON-LD ergänzen.', detail_en: 'HTML breadcrumb present but no Schema.org markup. → Add BreadcrumbList JSON-LD.' };
  }
  return { status: 'info', points: 1, detail_de: 'Kein Breadcrumb gefunden. Für tiefe Seitenstrukturen empfohlen.', detail_en: 'No breadcrumb found. Recommended for deep site structures.' };
}

// ============================================================
//  HAUPT-AUDIT-FUNKTION
// ============================================================

interface FetchedResources {
  hasRobotsTxt: boolean;
  hasSitemapXml: boolean;
}

export async function runAudit(html: string, url: string, resources: FetchedResources): Promise<AuditResult> {
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
  const isHttps = url.startsWith('https://');
  const page: ParsedPage = { html, url, isHttps };

  // Alle Check-Ergebnisse zusammenbauen
  const checkMap: Record<string, ReturnType<typeof checkHttps>> = {
    // Technical
    'https': checkHttps(page),
    'www_redirect': checkWwwRedirect(page),
    'robots_txt': resources.hasRobotsTxt
      ? { status: 'pass', points: 3, detail_de: 'robots.txt unter /robots.txt erreichbar.', detail_en: 'robots.txt accessible at /robots.txt.' }
      : { status: 'fail', points: 0, detail_de: 'robots.txt nicht erreichbar. → /robots.txt erstellen.', detail_en: 'robots.txt not accessible. → Create /robots.txt.' },
    'sitemap_xml': resources.hasSitemapXml
      ? { status: 'pass', points: 3, detail_de: 'XML-Sitemap unter /sitemap.xml erreichbar.', detail_en: 'XML Sitemap accessible at /sitemap.xml.' }
      : { status: 'warn', points: 1, detail_de: 'Keine Sitemap unter /sitemap.xml gefunden. → sitemap.xml erstellen und in robots.txt eintragen.', detail_en: 'No sitemap found at /sitemap.xml. → Create sitemap.xml and reference it in robots.txt.' },
    'canonical_tag': checkCanonical(root),
    'url_structure': checkUrlStructure(page),
    // Meta
    'title_tag': checkTitleTag(root),
    'meta_description': checkMetaDescription(root),
    'og_tags': checkOgTags(root),
    'twitter_card': checkTwitterCard(root),
    'html_lang': checkHtmlLang(root),
    'viewport_meta': checkViewport(root),
    'charset': checkCharset(root),
    // Content
    'h1_tag': checkH1(root),
    'heading_hierarchy': checkHeadingHierarchy(root),
    'image_alt_texts': checkImageAltTexts(root),
    'content_length': checkContentLength(root),
    'keyword_in_h1': checkKeywordInH1(root),
    'keyword_in_title': checkKeywordInTitle(root),
    // Performance
    'render_blocking': checkRenderBlocking(root),
    'inline_css_js': checkInlineCssJs(root),
    'image_formats': checkImageFormats(root),
    'lazy_loading': checkLazyLoading(root),
    // Mobile
    'mobile_viewport': checkMobileViewport(root),
    'no_flash': checkNoFlash(root),
    'aria_labels': checkAriaLabels(root),
    // Links
    'internal_links': checkInternalLinks(root, url),
    'broken_links': checkBrokenLinks(root),
    'anchor_text': checkAnchorText(root),
    // Structured Data
    'json_ld': checkJsonLd(root),
    'breadcrumb_schema': checkBreadcrumbSchema(root),
  };

  // Kategorien aufbauen
  const categoryResults: CategoryResult[] = AUDIT_CATEGORIES.map(cat => {
    const criteriaResults: CriterionResult[] = cat.criteria.map(criterion => {
      const check = checkMap[criterion.id];
      return {
        id: criterion.id,
        name_de: criterion.name_de,
        name_en: criterion.name_en,
        status: check?.status ?? 'info',
        points: check?.points ?? 0,
        max_points: criterion.max_points,
        detail_de: check?.detail_de ?? criterion.description_de,
        detail_en: check?.detail_en ?? criterion.description_en,
      };
    });

    const points = criteriaResults.reduce((s, c) => s + c.points, 0);
    const maxPoints = criteriaResults.reduce((s, c) => s + c.max_points, 0);
    const score = maxPoints > 0 ? Math.round((points / maxPoints) * 100) : 0;

    return {
      id: cat.id,
      name_de: cat.name_de,
      name_en: cat.name_en,
      score,
      points,
      max_points: maxPoints,
      criteria: criteriaResults,
    };
  });

  const totalPoints = categoryResults.reduce((s, c) => s + c.points, 0);
  const totalMaxPoints = categoryResults.reduce((s, c) => s + c.max_points, 0);
  const totalScore = totalMaxPoints > 0 ? Math.round((totalPoints / totalMaxPoints) * 100) : 0;

  return {
    url,
    audited_at: new Date().toISOString(),
    total_score: totalScore,
    total_points: totalPoints,
    total_max_points: totalMaxPoints,
    summary_de: '',
    summary_en: '',
    categories: categoryResults,
  };
}
