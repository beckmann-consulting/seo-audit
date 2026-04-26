import type {
  Finding, PageSEOData, PageSpeedData,
  AIReadinessInfo, SitemapInfo,
} from '@/types';
import { parseRobotsTxt, type RobotsGroup } from '../external-checks';
import {
  TITLE_LIMIT_MOBILE_PX,
  META_DESC_LIMIT_PX,
} from '../util/pixel-width';
import { id } from './utils';

// ============================================================
//  SEO FINDINGS
// ============================================================
export function generateSEOFindings(pages: PageSEOData[], hasRobots: boolean, hasSitemap: boolean): Finding[] {
  const findings: Finding[] = [];
  const homepage = pages[0];
  if (!homepage) return findings;

  // robots.txt
  if (!hasRobots) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
      title_de: 'robots.txt fehlt',
      title_en: 'robots.txt missing',
      description_de: 'Keine robots.txt unter /robots.txt gefunden. Suchmaschinen haben keinen Hinweis auf Crawling-Regeln.',
      description_en: 'No robots.txt found at /robots.txt. Search engines have no guidance on crawling rules.',
      recommendation_de: 'robots.txt erstellen mit: User-agent: * / Allow: / und einem Verweis auf die Sitemap.',
      recommendation_en: 'Create robots.txt with: User-agent: * / Allow: / and a reference to the sitemap.',
    });
  }

  // sitemap
  if (!hasSitemap) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'high',
      title_de: 'XML-Sitemap fehlt',
      title_en: 'XML sitemap missing',
      description_de: 'Keine sitemap.xml gefunden. Google crawlt Unterseiten langsamer und unzuverlässiger.',
      description_en: 'No sitemap.xml found. Google crawls subpages slower and less reliably.',
      recommendation_de: 'sitemap.xml erstellen und in der robots.txt sowie Google Search Console einreichen.',
      recommendation_en: 'Create sitemap.xml and submit it in robots.txt and Google Search Console.',
    });
  }

  // Check all pages for missing titles
  const pagesWithoutTitle = pages.filter(p => !p.title || p.title.length === 0);
  if (pagesWithoutTitle.length > 0) {
    findings.push({
      id: id(), priority: 'critical', module: 'seo', effort: 'low', impact: 'high',
      title_de: `${pagesWithoutTitle.length} Seite(n) ohne Title-Tag`,
      title_en: `${pagesWithoutTitle.length} page(s) missing title tag`,
      description_de: `Folgende Seiten haben keinen Title-Tag: ${pagesWithoutTitle.slice(0, 3).map(p => p.url).join(', ')}${pagesWithoutTitle.length > 3 ? ` +${pagesWithoutTitle.length - 3} weitere` : ''}`,
      description_en: `The following pages have no title tag: ${pagesWithoutTitle.slice(0, 3).map(p => p.url).join(', ')}${pagesWithoutTitle.length > 3 ? ` +${pagesWithoutTitle.length - 3} more` : ''}`,
      recommendation_de: 'Jede Seite braucht einen einzigartigen, 50–60 Zeichen langen Title-Tag mit dem primären Keyword.',
      recommendation_en: 'Every page needs a unique, 50–60 character title tag with the primary keyword.',
    });
  }

  // Titles too long
  const titlesTooLong = pages.filter(p => p.titleLength && p.titleLength > 65);
  if (titlesTooLong.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${titlesTooLong.length} Title-Tag(s) zu lang (>65 Zeichen)`,
      title_en: `${titlesTooLong.length} title tag(s) too long (>65 chars)`,
      description_de: titlesTooLong.slice(0, 2).map(p => `"${p.title}" (${p.titleLength} Zeichen) — ${p.url}`).join('\n'),
      description_en: titlesTooLong.slice(0, 2).map(p => `"${p.title}" (${p.titleLength} chars) — ${p.url}`).join('\n'),
      recommendation_de: 'Title auf 50–60 Zeichen kürzen. Google kürzt ab ca. 60–65 Zeichen.',
      recommendation_en: 'Shorten title to 50–60 characters. Google truncates at ~60–65 characters.',
    });
  }

  // Titles too short
  const titlesTooShort = pages.filter(p => p.titleLength !== undefined && p.titleLength > 0 && p.titleLength < 30);
  if (titlesTooShort.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${titlesTooShort.length} Title-Tag(s) zu kurz (<30 Zeichen)`,
      title_en: `${titlesTooShort.length} title tag(s) too short (<30 chars)`,
      description_de: titlesTooShort.slice(0, 2).map(p => `"${p.title}" (${p.titleLength} Zeichen) — ${p.url}`).join('\n'),
      description_en: titlesTooShort.slice(0, 2).map(p => `"${p.title}" (${p.titleLength} chars) — ${p.url}`).join('\n'),
      recommendation_de: 'Title auf 50–60 Zeichen ausbauen. Zu kurze Titel nutzen SERP-Platz nicht und liefern zu wenig Ranking-Signal.',
      recommendation_en: 'Expand title to 50–60 characters. Titles that are too short waste SERP real estate and provide too little ranking signal.',
    });
  }

  // Meta descriptions missing
  const pagesWithoutDesc = pages.filter(p => !p.metaDescription || p.metaDescription.length === 0);
  if (pagesWithoutDesc.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'high',
      title_de: `${pagesWithoutDesc.length} Seite(n) ohne Meta-Description`,
      title_en: `${pagesWithoutDesc.length} page(s) missing meta description`,
      description_de: `Betroffen: ${pagesWithoutDesc.slice(0, 3).map(p => p.url).join(', ')}`,
      description_en: `Affected: ${pagesWithoutDesc.slice(0, 3).map(p => p.url).join(', ')}`,
      recommendation_de: 'Meta-Description mit 140–160 Zeichen, primärem Keyword und Call-to-Action ergänzen.',
      recommendation_en: 'Add meta description with 140–160 characters, primary keyword and call-to-action.',
    });
  }

  // Meta descriptions too short
  const descsTooShort = pages.filter(p =>
    p.metaDescriptionLength !== undefined &&
    p.metaDescriptionLength > 0 &&
    p.metaDescriptionLength < 70
  );
  if (descsTooShort.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${descsTooShort.length} Meta-Description(s) zu kurz (<70 Zeichen)`,
      title_en: `${descsTooShort.length} meta description(s) too short (<70 chars)`,
      description_de: descsTooShort.slice(0, 3).map(p => `${p.url} (${p.metaDescriptionLength} Zeichen)`).join('\n'),
      description_en: descsTooShort.slice(0, 3).map(p => `${p.url} (${p.metaDescriptionLength} chars)`).join('\n'),
      recommendation_de: 'Meta-Description auf 140–160 Zeichen ausbauen. Zu kurze Snippets verschenken SERP-Fläche und CTR.',
      recommendation_en: 'Expand meta description to 140–160 characters. Descriptions that are too short waste SERP space and CTR.',
    });
  }

  // OG tags on homepage
  if (!homepage.ogTitle || !homepage.ogDescription || !homepage.ogImage) {
    const missing = [
      !homepage.ogTitle && 'og:title',
      !homepage.ogDescription && 'og:description',
      !homepage.ogImage && 'og:image',
    ].filter(Boolean);
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'high',
      title_de: `Open Graph Tags fehlen: ${missing.join(', ')}`,
      title_en: `Open Graph tags missing: ${missing.join(', ')}`,
      description_de: 'Beim Teilen der Website auf LinkedIn, X oder Facebook erscheint keine Vorschau. Das reduziert Klickraten erheblich.',
      description_en: 'Sharing the website on LinkedIn, X or Facebook produces no preview card, significantly reducing click rates.',
      recommendation_de: `${missing.join(', ')} in den Seiteneinstellungen ergänzen. og:image sollte 1200×630px sein.`,
      recommendation_en: `Add ${missing.join(', ')} in page settings. og:image should be 1200×630px.`,
    });
  }

  // Schema markup
  const pagesWithSchema = pages.filter(p => p.schemaTypes.length > 0);
  if (pagesWithSchema.length === 0) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'high',
      title_de: 'Kein Schema.org / JSON-LD Markup vorhanden',
      title_en: 'No Schema.org / JSON-LD markup present',
      description_de: 'Strukturierte Daten fehlen vollständig. Google kann die Organisation, Produkte und Inhalte nicht als Rich Snippets darstellen.',
      description_en: 'Structured data is completely missing. Google cannot display the organisation, products and content as rich snippets.',
      recommendation_de: 'Organization, WebSite und seitenspezifische Schemas (Product, Article, FAQPage) als JSON-LD im <head> ergänzen.',
      recommendation_en: 'Add Organization, WebSite and page-specific schemas (Product, Article, FAQPage) as JSON-LD in the <head>.',
    });
  }

  // Canonical tags
  const pagesWithoutCanonical = pages.filter(p => !p.hasCanonical);
  if (pagesWithoutCanonical.length > 2) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${pagesWithoutCanonical.length} Seite(n) ohne Canonical-Tag`,
      title_en: `${pagesWithoutCanonical.length} page(s) without canonical tag`,
      description_de: 'Fehlende Canonical-Tags können zu Duplicate-Content-Problemen führen.',
      description_en: 'Missing canonical tags can lead to duplicate content issues.',
      recommendation_de: '<link rel="canonical" href="[volle URL]"> auf jeder Seite im <head> setzen.',
      recommendation_en: 'Set <link rel="canonical" href="[full URL]"> on every page in the <head>.',
    });
  }

  // HTML lang missing
  if (!homepage.lang) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: 'HTML lang-Attribut fehlt',
      title_en: 'HTML lang attribute missing',
      description_de: 'Das <html>-Tag hat kein lang-Attribut. Suchmaschinen und Screenreader können die Sprache nicht erkennen.',
      description_en: 'The <html> tag has no lang attribute. Search engines and screen readers cannot identify the language.',
      recommendation_de: '<html lang="de"> oder <html lang="en"> setzen.',
      recommendation_en: 'Set <html lang="de"> or <html lang="en">.',
    });
  }

  // Pagination pages without self-referencing canonical
  const paginationRegex = /(\?page=|\?p=|\/page\/)/i;
  const paginationWithoutCanonical = pages.filter(p => {
    if (!paginationRegex.test(p.url)) return false;
    if (!p.canonicalUrl) return true;
    // Self-referencing canonical required
    try {
      return new URL(p.canonicalUrl, p.url).href !== p.url;
    } catch {
      return true;
    }
  });
  if (paginationWithoutCanonical.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `${paginationWithoutCanonical.length} Paginations-Seite(n) ohne self-referencing Canonical`,
      title_en: `${paginationWithoutCanonical.length} pagination page(s) without self-referencing canonical`,
      description_de: `Betroffen: ${paginationWithoutCanonical.slice(0, 3).map(p => p.url).join(', ')}. Paginierte Seiten brauchen einen Canonical auf sich selbst, damit Google sie als eigene Seiten indexiert und nicht als Duplikate der Seite 1.`,
      description_en: `Affected: ${paginationWithoutCanonical.slice(0, 3).map(p => p.url).join(', ')}. Paginated pages need a self-referencing canonical so Google indexes them as distinct pages rather than duplicates of page 1.`,
      recommendation_de: 'Auf jeder ?page=/page/ Seite <link rel="canonical" href="[exakt diese URL]"> setzen. Zusätzlich rel="next"/"prev" für die Paginierung nutzen.',
      recommendation_en: 'Set <link rel="canonical" href="[this exact URL]"> on every ?page=/page/ URL. Additionally use rel="next"/"prev" for pagination semantics.',
    });
  }

  // Weak internal linking — moved to the SEO module in D2. Previously
  // lived in generateUXFindings but link equity / crawl discoverability
  // is fundamentally an SEO concern, not a UX one.
  const pagesWithFewInternalLinks = pages.filter(p => p.internalLinks.length < 3);
  if (pagesWithFewInternalLinks.length > pages.length * 0.5) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: 'Schwache interne Verlinkung auf vielen Seiten',
      title_en: 'Weak internal linking on many pages',
      description_de: `${pagesWithFewInternalLinks.length} von ${pages.length} Seiten haben weniger als 3 interne Links.`,
      description_en: `${pagesWithFewInternalLinks.length} of ${pages.length} pages have fewer than 3 internal links.`,
      recommendation_de: 'Interne Verlinkung ausbauen. Verwandte Seiten und CTAs auf jeder Seite verlinken.',
      recommendation_en: 'Build up internal linking. Link related pages and CTAs on every page.',
    });
  }

  return findings;
}


// ============================================================
//  HREFLANG FINDINGS
// ============================================================
// Valid hreflang values: ISO 639-1 (2-letter language),
// optionally followed by "-" and ISO 3166-1 alpha-2 region,
// or the special value "x-default".
const HREFLANG_PATTERN = /^(x-default|[a-z]{2}(-[A-Z]{2})?)$/;

export function generateHreflangFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  const pagesWithHreflang = pages.filter(p => p.hreflangs.length > 0);
  const distinctLangs = new Set(pages.map(p => p.lang).filter(Boolean));
  const siteSeemsMultilingual = pagesWithHreflang.length > 0 || distinctLangs.size > 1;

  // If site doesn't seem multilingual, skip hreflang checks entirely
  if (!siteSeemsMultilingual) return findings;

  // 1) Some pages have hreflang, others don't → inconsistent implementation
  if (pagesWithHreflang.length > 0 && pagesWithHreflang.length < pages.length) {
    const missingOn = pages.filter(p => p.hreflangs.length === 0);
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `Hreflang-Tags fehlen auf ${missingOn.length} von ${pages.length} Seiten`,
      title_en: `Hreflang tags missing on ${missingOn.length} of ${pages.length} pages`,
      description_de: 'Hreflang muss auf allen Sprachvarianten einer Seite gesetzt sein — sonst kann Google die Sprachbeziehung nicht zuverlässig auflösen und die falsche Variante im SERP ausliefern.',
      description_en: 'Hreflang must be set on every language variant of a page — otherwise Google cannot reliably resolve the language relationship and may serve the wrong variant in SERPs.',
      recommendation_de: `Hreflang-Tags auf allen übersetzten Seiten ergänzen. Betroffen u.a.: ${missingOn.slice(0, 3).map(p => p.url).join(', ')}${missingOn.length > 3 ? '...' : ''}`,
      recommendation_en: `Add hreflang tags on all translated pages. Affected e.g.: ${missingOn.slice(0, 3).map(p => p.url).join(', ')}${missingOn.length > 3 ? '...' : ''}`,
    });
  }

  // Per-page checks
  for (const page of pagesWithHreflang) {
    const hreflangs = page.hreflangs;

    // 2) Invalid language codes
    const invalid = hreflangs.filter(h => !HREFLANG_PATTERN.test(h.hreflang));
    if (invalid.length > 0) {
      findings.push({
        id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
        title_de: `Ungültige hreflang-Werte: ${invalid.map(h => `"${h.hreflang}"`).join(', ')}`,
        title_en: `Invalid hreflang values: ${invalid.map(h => `"${h.hreflang}"`).join(', ')}`,
        description_de: 'Gültige Werte sind ISO 639-1 Sprachcodes (z.B. "de", "en"), optional mit ISO 3166-1 Region ("de-CH", "en-US"), oder "x-default". Ungültige Werte werden von Google ignoriert.',
        description_en: 'Valid values are ISO 639-1 language codes (e.g. "de", "en"), optionally with ISO 3166-1 region ("de-CH", "en-US"), or "x-default". Invalid values are ignored by Google.',
        recommendation_de: 'Sprachcodes auf korrektes Format umstellen. Groß-/Kleinschreibung beachten: Sprache klein, Region groß ("de-DE" statt "DE-de").',
        recommendation_en: 'Fix language codes to the correct format. Mind the case: language lowercase, region uppercase ("de-DE" not "DE-de").',
        affectedUrl: page.url,
      });
    }

    // 3) Self-reference missing
    const hasSelfRef = hreflangs.some(h => {
      try {
        return new URL(h.href).href === new URL(page.url).href;
      } catch {
        return false;
      }
    });
    if (!hasSelfRef) {
      findings.push({
        id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
        title_de: 'Hreflang-Selbstreferenz fehlt',
        title_en: 'Hreflang self-reference missing',
        description_de: 'Jede Seite muss einen hreflang-Tag haben, der auf sich selbst zeigt. Ohne Selbstreferenz gilt die Sprachgruppe für Google als unvollständig.',
        description_en: 'Every page must have a hreflang tag pointing to itself. Without self-reference, Google considers the language group incomplete.',
        recommendation_de: `Auf dieser Seite einen hreflang-Tag mit href="${page.url}" und dem passenden Sprachcode ergänzen.`,
        recommendation_en: `Add a hreflang tag on this page with href="${page.url}" and the matching language code.`,
        affectedUrl: page.url,
      });
    }

    // 4) x-default missing (only flag once per distinct set to avoid spam — but we check per page anyway)
    const hasXDefault = hreflangs.some(h => h.hreflang === 'x-default');
    if (!hasXDefault) {
      findings.push({
        id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
        title_de: 'Hreflang "x-default" fehlt',
        title_en: 'Hreflang "x-default" missing',
        description_de: '"x-default" legt fest, welche Variante Google ausliefert, wenn keine Sprachversion zur Nutzerpräferenz passt. Empfohlen bei mehrsprachigen Seiten.',
        description_en: '"x-default" defines which variant Google serves when no language version matches the user preference. Recommended for multilingual sites.',
        recommendation_de: 'Einen hreflang-Tag mit hreflang="x-default" und href auf die Standard-/Fallback-Variante (meist Englisch oder die Hauptseite) ergänzen.',
        recommendation_en: 'Add a hreflang tag with hreflang="x-default" and href pointing to the default/fallback variant (usually English or the main page).',
        affectedUrl: page.url,
      });
    }

    // 5) Relative hrefs (should be absolute per Google's guidance)
    const relative = hreflangs.filter(h => !/^https?:\/\//i.test(h.href));
    if (relative.length > 0) {
      findings.push({
        id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'low',
        title_de: `Hreflang mit relativen URLs: ${relative.length}`,
        title_en: `Hreflang with relative URLs: ${relative.length}`,
        description_de: 'Google empfiehlt absolute URLs in hreflang-Tags. Relative URLs werden zwar oft korrekt aufgelöst, sind aber fehleranfällig bei Basis-Tag-Änderungen.',
        description_en: 'Google recommends absolute URLs in hreflang tags. Relative URLs are often resolved correctly but are error-prone when base tags change.',
        recommendation_de: 'Alle hreflang-href-Werte auf vollständige absolute URLs umstellen.',
        recommendation_en: 'Change all hreflang href values to fully absolute URLs.',
        affectedUrl: page.url,
      });
    }
  }

  // 6) Bidirectional reciprocity — only checkable across crawled pages.
  // If page A lists hreflang pointing to page B (within the crawl), B must list A back.
  const pageUrlSet = new Set(pages.map(p => {
    try { return new URL(p.url).href; } catch { return p.url; }
  }));
  const hreflangsByUrl = new Map<string, { hreflang: string; href: string }[]>();
  for (const p of pagesWithHreflang) {
    try {
      hreflangsByUrl.set(new URL(p.url).href, p.hreflangs);
    } catch {
      hreflangsByUrl.set(p.url, p.hreflangs);
    }
  }

  const reciprocityIssues: { from: string; to: string }[] = [];
  for (const [fromUrl, hreflangs] of hreflangsByUrl) {
    for (const hl of hreflangs) {
      if (hl.hreflang === 'x-default') continue;
      let targetUrl: string;
      try {
        targetUrl = new URL(hl.href).href;
      } catch {
        continue;
      }
      if (targetUrl === fromUrl) continue; // self-ref
      if (!pageUrlSet.has(targetUrl)) continue; // target not in crawl — can't verify
      const targetHreflangs = hreflangsByUrl.get(targetUrl) || [];
      const linksBack = targetHreflangs.some(h => {
        try {
          return new URL(h.href).href === fromUrl;
        } catch {
          return false;
        }
      });
      if (!linksBack) {
        reciprocityIssues.push({ from: fromUrl, to: targetUrl });
      }
    }
  }

  if (reciprocityIssues.length > 0) {
    const sample = reciprocityIssues.slice(0, 3).map(r => `${r.from} → ${r.to}`).join('; ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `Hreflang nicht bidirektional: ${reciprocityIssues.length} Fälle`,
      title_en: `Hreflang not bidirectional: ${reciprocityIssues.length} cases`,
      description_de: `Wenn Seite A per hreflang auf Seite B verweist, muss B auch zurück auf A verweisen. Fehlende Rückverweise werden von Google ignoriert. Beispiele: ${sample}`,
      description_en: `If page A references page B via hreflang, B must also reference A back. Missing back-references are ignored by Google. Examples: ${sample}`,
      recommendation_de: 'Auf jeder Seite der Sprachgruppe exakt dieselbe hreflang-Liste ausliefern (einschließlich aller Varianten + x-default + Selbstreferenz).',
      recommendation_en: 'Serve the exact same hreflang list on every page of the language group (including all variants + x-default + self-reference).',
    });
  }

  return findings;
}


// ============================================================
//  CRAWL STRUCTURE: ORPHAN PAGES & CLICK DEPTH
// ============================================================
// Mutates `pages` to populate `inlinkCount` per page based on cross-page
// internal links from the crawl. Also emits findings for orphan pages
// (0 inlinks from other crawled pages) and pages buried too deep
// (click depth >= 4 from the start URL).
export function generateCrawlStructureFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length < 2) return findings;

  // Build a normalised URL -> page map
  const urlToPage = new Map<string, PageSEOData>();
  for (const p of pages) {
    urlToPage.set(normalizeUrl(p.url), p);
  }

  // Count inlinks: for each page, how many OTHER pages link to it?
  const inlinks = new Map<string, number>();
  for (const p of pages) {
    const from = normalizeUrl(p.url);
    const seen = new Set<string>();
    for (const link of p.internalLinks) {
      const target = normalizeUrl(link);
      if (target === from) continue; // self-link doesn't count
      if (seen.has(target)) continue; // dedupe multi-links from same page
      seen.add(target);
      if (urlToPage.has(target)) {
        inlinks.set(target, (inlinks.get(target) || 0) + 1);
      }
    }
  }

  // Write inlink count back onto each page
  for (const p of pages) {
    p.inlinkCount = inlinks.get(normalizeUrl(p.url)) || 0;
  }

  // --- Orphan pages: pages with 0 inlinks (excluding the start page at depth 0) ---
  const orphans = pages.filter(p => (p.inlinkCount ?? 0) === 0 && p.depth > 0);
  if (orphans.length > 0) {
    const sample = orphans.slice(0, 5).map(p => p.url).join(', ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'high',
      title_de: `Orphan Pages: ${orphans.length} Seiten ohne interne Links`,
      title_en: `Orphan pages: ${orphans.length} pages with no internal links`,
      description_de: `Diese Seiten sind aus anderen gecrawlten Seiten nicht verlinkt — Google wird sie nur über Sitemap oder externe Links finden. Linkjuice geht verloren. Beispiele: ${sample}`,
      description_en: `These pages are not linked from any other crawled page — Google will only discover them via sitemap or external links. Link equity is lost. Examples: ${sample}`,
      recommendation_de: 'Orphan Pages von thematisch passenden Hub-Seiten aus verlinken (Menüs, Sidebars, Content-Links). Falls eine Seite wirklich nicht wichtig ist: per noindex entfernen.',
      recommendation_en: 'Link orphan pages from topically relevant hub pages (menus, sidebars, content links). If a page is truly not important: remove it via noindex.',
    });
  }

  // --- Crawl depth: pages deeper than 3 clicks ---
  // Google generally recommends max 3 clicks from the homepage for important pages.
  const deepPages = pages.filter(p => p.depth >= 4);
  if (deepPages.length > 0) {
    const ratio = deepPages.length / pages.length;
    const maxDepth = Math.max(...pages.map(p => p.depth));
    const priority: 'important' | 'recommended' = ratio > 0.3 ? 'important' : 'recommended';
    findings.push({
      id: id(), priority, module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `${deepPages.length} Seiten mit Klicktiefe >= 4 (max: ${maxDepth})`,
      title_en: `${deepPages.length} pages at click depth >= 4 (max: ${maxDepth})`,
      description_de: `${Math.round(ratio * 100)}% der gecrawlten Seiten sind mindestens 4 Klicks von der Startseite entfernt. Tiefe Seiten werden seltener gecrawlt und bekommen weniger Linkjuice.`,
      description_en: `${Math.round(ratio * 100)}% of crawled pages are at least 4 clicks from the start page. Deep pages are crawled less often and receive less link equity.`,
      recommendation_de: 'Flachere Informationsarchitektur anstreben: Hub-Seiten, Kategorieseiten und interne Querverweise nutzen. Wichtige Seiten sollten innerhalb von 3 Klicks erreichbar sein.',
      recommendation_en: 'Aim for a flatter information architecture: use hub pages, category pages and internal cross-links. Important pages should be reachable within 3 clicks.',
    });
  }

  // --- Under-linked pages (1 inlink): less urgent but worth noting ---
  const underLinked = pages.filter(p => (p.inlinkCount ?? 0) === 1 && p.depth > 0);
  if (underLinked.length > pages.length * 0.3) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'medium', impact: 'low',
      title_de: `${underLinked.length} Seiten mit nur einem internen Inlink`,
      title_en: `${underLinked.length} pages with only one internal inlink`,
      description_de: 'Ein Großteil der Seiten wird nur von einer einzigen anderen Seite verlinkt. Mehrfache Verlinkung stärkt die interne Linkstruktur und hilft bei Ranking und Crawlability.',
      description_en: 'A large share of pages is linked from only one other page. Multiple inlinks strengthen the internal link structure and help ranking and crawlability.',
      recommendation_de: 'Wichtige Seiten aus mehreren Kontexten heraus verlinken (thematisch verwandte Artikel, Footer, Sitemaps, Breadcrumbs).',
      recommendation_en: 'Link important pages from multiple contexts (topically related articles, footer, sitemaps, breadcrumbs).',
    });
  }

  return findings;
}


// ============================================================
//  DUPLICATE CONTENT & CANONICAL CONFLICTS
// ============================================================
function normalizeText(s?: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    // Drop fragment, normalise trailing slash on path (except root)
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return u;
  }
}

export function generateDuplicateContentFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length < 2) return findings;

  // --- Duplicate titles ---
  const titleGroups = new Map<string, string[]>();
  for (const p of pages) {
    const t = normalizeText(p.title);
    if (!t) continue;
    const list = titleGroups.get(t) || [];
    list.push(p.url);
    titleGroups.set(t, list);
  }
  const dupeTitles = [...titleGroups.entries()].filter(([, urls]) => urls.length > 1);
  if (dupeTitles.length > 0) {
    const totalAffected = dupeTitles.reduce((s, [, urls]) => s + urls.length, 0);
    const sample = dupeTitles.slice(0, 2).map(([t, urls]) => `"${t.slice(0, 50)}" (${urls.length}x)`).join(', ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'high',
      title_de: `Duplikate im Title: ${dupeTitles.length} Gruppen, ${totalAffected} Seiten`,
      title_en: `Duplicate titles: ${dupeTitles.length} groups, ${totalAffected} pages`,
      description_de: `Mehrere Seiten teilen denselben Title-Tag. Das verwässert Ranking-Signale und erschwert Google die Auswahl der relevanten Version. Beispiele: ${sample}`,
      description_en: `Multiple pages share the same title tag. This dilutes ranking signals and makes it harder for Google to pick the relevant version. Examples: ${sample}`,
      recommendation_de: 'Jede Seite braucht einen eindeutigen, beschreibenden Title. Template-Fallbacks durch seiten-spezifische Varianten ersetzen.',
      recommendation_en: 'Each page needs a unique, descriptive title. Replace template fallbacks with page-specific variants.',
    });
  }

  // --- Duplicate meta descriptions ---
  const descGroups = new Map<string, string[]>();
  for (const p of pages) {
    const d = normalizeText(p.metaDescription);
    if (!d) continue;
    const list = descGroups.get(d) || [];
    list.push(p.url);
    descGroups.set(d, list);
  }
  const dupeDesc = [...descGroups.entries()].filter(([, urls]) => urls.length > 1);
  if (dupeDesc.length > 0) {
    const totalAffected = dupeDesc.reduce((s, [, urls]) => s + urls.length, 0);
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `Duplikate in Meta-Description: ${dupeDesc.length} Gruppen, ${totalAffected} Seiten`,
      title_en: `Duplicate meta descriptions: ${dupeDesc.length} groups, ${totalAffected} pages`,
      description_de: 'Mehrere Seiten verwenden dieselbe Meta-Description. Google schreibt diese häufig ohnehin um, eindeutige Descriptions verbessern aber die CTR im SERP.',
      description_en: 'Multiple pages use the same meta description. Google often rewrites these anyway, but unique descriptions improve SERP CTR.',
      recommendation_de: 'Jede Seite braucht eine einzigartige, seiten-spezifische Meta-Description (140-160 Zeichen).',
      recommendation_en: 'Each page needs a unique, page-specific meta description (140-160 characters).',
    });
  }

  // --- Duplicate H1s ---
  const h1Groups = new Map<string, string[]>();
  for (const p of pages) {
    const h1 = normalizeText(p.h1s[0]);
    if (!h1) continue;
    const list = h1Groups.get(h1) || [];
    list.push(p.url);
    h1Groups.set(h1, list);
  }
  const dupeH1 = [...h1Groups.entries()].filter(([, urls]) => urls.length > 1);
  if (dupeH1.length > 0) {
    const totalAffected = dupeH1.reduce((s, [, urls]) => s + urls.length, 0);
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `Duplikate im H1: ${dupeH1.length} Gruppen, ${totalAffected} Seiten`,
      title_en: `Duplicate H1s: ${dupeH1.length} groups, ${totalAffected} pages`,
      description_de: 'Mehrere Seiten verwenden denselben H1. Der H1 sollte das jeweilige Seitenthema eindeutig benennen — generische Werte wie "Willkommen" oder "Home" schwächen die semantische Struktur.',
      description_en: 'Multiple pages use the same H1. The H1 should uniquely name each page\'s topic — generic values like "Welcome" or "Home" weaken semantic structure.',
      recommendation_de: 'Jeder Seite einen eindeutigen H1 geben, der das Seitenthema beschreibt.',
      recommendation_en: 'Give each page a unique H1 that describes the page topic.',
    });
  }

  // --- Canonical issues ---
  const pageUrlMap = new Map<string, PageSEOData>();
  for (const p of pages) {
    pageUrlMap.set(normalizeUrl(p.url), p);
  }

  for (const page of pages) {
    if (!page.canonicalUrl) continue;

    // Relative canonical
    if (!/^https?:\/\//i.test(page.canonicalUrl)) {
      findings.push({
        id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'low',
        title_de: 'Canonical ist relativ',
        title_en: 'Canonical is relative',
        description_de: 'Google empfiehlt absolute Canonical-URLs. Relative Werte werden zwar meist korrekt aufgelöst, sind aber fehleranfällig.',
        description_en: 'Google recommends absolute canonical URLs. Relative values are usually resolved correctly but are error-prone.',
        recommendation_de: `Canonical auf absolute URL umstellen, z.B. "${new URL(page.canonicalUrl, page.url).href}".`,
        recommendation_en: `Change canonical to absolute URL, e.g. "${new URL(page.canonicalUrl, page.url).href}".`,
        affectedUrl: page.url,
      });
      continue;
    }

    // Protocol mismatch: HTTPS page with HTTP canonical
    if (page.url.startsWith('https://') && page.canonicalUrl.startsWith('http://')) {
      findings.push({
        id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
        title_de: 'Canonical zeigt auf HTTP statt HTTPS',
        title_en: 'Canonical points to HTTP instead of HTTPS',
        description_de: 'Die Seite wird über HTTPS ausgeliefert, aber die Canonical-URL verwendet HTTP. Das kann zu Indexierungskonflikten führen.',
        description_en: 'The page is served over HTTPS but the canonical URL uses HTTP. This can cause indexing conflicts.',
        recommendation_de: 'Canonical auf HTTPS umstellen.',
        recommendation_en: 'Change canonical to HTTPS.',
        affectedUrl: page.url,
      });
    }

    const normalizedPageUrl = normalizeUrl(page.url);
    const normalizedCanonical = normalizeUrl(page.canonicalUrl);
    if (normalizedPageUrl === normalizedCanonical) continue; // self-canonical, fine

    // Canonical points to another crawled page
    const target = pageUrlMap.get(normalizedCanonical);
    if (target) {
      // Check if target has a different canonical → canonical chain
      if (target.canonicalUrl) {
        const targetCanonical = normalizeUrl(target.canonicalUrl);
        if (targetCanonical !== normalizedCanonical && targetCanonical !== normalizedPageUrl) {
          findings.push({
            id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'high',
            title_de: 'Canonical-Kette erkannt',
            title_en: 'Canonical chain detected',
            description_de: `Seite A zeigt auf B, aber B zeigt auf C. Google folgt Canonical-Ketten nur begrenzt — das Signal kann verloren gehen. Kette: ${page.url} → ${page.canonicalUrl} → ${target.canonicalUrl}`,
            description_en: `Page A points to B, but B points to C. Google follows canonical chains only to a limited extent — the signal can be lost. Chain: ${page.url} → ${page.canonicalUrl} → ${target.canonicalUrl}`,
            recommendation_de: 'Canonical direkt auf die finale Ziel-URL zeigen lassen, ohne Zwischenstationen.',
            recommendation_en: 'Point canonical directly to the final target URL, without intermediate stops.',
            affectedUrl: page.url,
          });
        }
      }
    }
  }

  // Pages that point to a canonical different from themselves → summarize
  const nonSelfCanonical = pages.filter(p => {
    if (!p.canonicalUrl) return false;
    try {
      return normalizeUrl(p.canonicalUrl) !== normalizeUrl(p.url);
    } catch {
      return false;
    }
  });
  if (nonSelfCanonical.length > 0 && nonSelfCanonical.length < pages.length) {
    // This is informational — self-canonicals are the norm, non-self means the page
    // is explicitly not the indexable version. Only flag if a noticeable share.
    const ratio = nonSelfCanonical.length / pages.length;
    if (ratio > 0.2) {
      findings.push({
        id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
        title_de: `${nonSelfCanonical.length} Seiten mit Fremd-Canonical (${Math.round(ratio * 100)}%)`,
        title_en: `${nonSelfCanonical.length} pages with non-self canonical (${Math.round(ratio * 100)}%)`,
        description_de: 'Viele Seiten haben einen Canonical, der nicht auf sie selbst zeigt. Das heißt: sie werden von Google nicht als Hauptversion indexiert. Falls das ungewollt ist, sind diese Seiten "unsichtbar".',
        description_en: 'Many pages have a canonical that does not point to themselves. This means Google does not index them as the main version. If unintended, these pages are "invisible".',
        recommendation_de: 'Prüfen, ob die betroffenen Seiten eigenständig ranken sollen. Falls ja: Canonical auf die Seite selbst setzen.',
        recommendation_en: 'Check whether the affected pages should rank independently. If yes: set canonical to the page itself.',
      });
    }
  }

  return findings;
}


// ============================================================
//  STRUCTURED DATA DEEP VALIDATION
// ============================================================
// Required fields for common Rich Results types (Google guidelines).
// "author", "image" etc. can be strings or objects — we only check presence.
const SCHEMA_REQUIRED_FIELDS: Record<string, string[]> = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address', 'telephone'],
  Person: ['name'],
  WebSite: ['name', 'url'],
  Article: ['headline', 'image', 'datePublished', 'author'],
  NewsArticle: ['headline', 'image', 'datePublished', 'author'],
  BlogPosting: ['headline', 'image', 'datePublished', 'author'],
  Product: ['name', 'image'],
  Offer: ['price', 'priceCurrency', 'availability'],
  Recipe: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
  Event: ['name', 'startDate', 'location'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Review: ['itemReviewed', 'reviewRating', 'author'],
  AggregateRating: ['ratingValue', 'reviewCount'],
  VideoObject: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
  HowTo: ['name', 'step'],
  JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization'],
};

function hasField(data: Record<string, unknown>, field: string): boolean {
  const v = data[field];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

export function generateStructuredDataFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // 1) JSON-LD parse errors
  const pagesWithParseErrors = pages.filter(p => p.schemaParseErrors > 0);
  if (pagesWithParseErrors.length > 0) {
    const total = pagesWithParseErrors.reduce((s, p) => s + p.schemaParseErrors, 0);
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `JSON-LD Parse-Fehler: ${total} Block(s) auf ${pagesWithParseErrors.length} Seite(n)`,
      title_en: `JSON-LD parse errors: ${total} block(s) on ${pagesWithParseErrors.length} page(s)`,
      description_de: 'Mindestens ein <script type="application/ld+json"> enthält ungültiges JSON. Google ignoriert kaputtes Markup komplett — keine Rich Snippets für diese Seiten.',
      description_en: 'At least one <script type="application/ld+json"> contains invalid JSON. Google ignores broken markup entirely — no rich snippets for these pages.',
      recommendation_de: 'JSON-LD mit Google Rich Results Test (search.google.com/test/rich-results) validieren. Häufige Fehler: Trailing Commas, unescaped Anführungszeichen, fehlende Klammern.',
      recommendation_en: 'Validate JSON-LD with Google Rich Results Test (search.google.com/test/rich-results). Common errors: trailing commas, unescaped quotes, missing brackets.',
      affectedUrl: pagesWithParseErrors[0].url,
    });
  }

  // 2) Per-schema required field validation
  type MissingPerType = { type: string; missing: string[]; url: string };
  const issues: MissingPerType[] = [];

  for (const page of pages) {
    for (const schema of page.schemas) {
      const required = SCHEMA_REQUIRED_FIELDS[schema.type];
      if (!required) continue; // unknown type, skip
      const missing = required.filter(f => !hasField(schema.data, f));
      if (missing.length > 0) {
        issues.push({ type: schema.type, missing, url: page.url });
      }
    }
  }

  // Group issues by type to avoid one finding per page
  const byType = new Map<string, MissingPerType[]>();
  for (const issue of issues) {
    const list = byType.get(issue.type) || [];
    list.push(issue);
    byType.set(issue.type, list);
  }

  for (const [type, list] of byType) {
    // Use union of missing fields across all occurrences as a summary
    const allMissing = new Set<string>();
    list.forEach(l => l.missing.forEach(f => allMissing.add(f)));
    const sampleUrl = list[0].url;
    const priority: 'important' | 'recommended' =
      ['Article', 'NewsArticle', 'BlogPosting', 'Product', 'Recipe', 'Event', 'JobPosting'].includes(type)
        ? 'important'
        : 'recommended';

    findings.push({
      id: id(), priority, module: 'seo', effort: 'low', impact: 'medium',
      title_de: `Schema.org ${type}: Pflichtfelder fehlen (${[...allMissing].join(', ')})`,
      title_en: `Schema.org ${type}: required fields missing (${[...allMissing].join(', ')})`,
      description_de: `Auf ${list.length} Seite(n) fehlen in ${type}-Schemas die von Google für Rich Results geforderten Felder: ${[...allMissing].join(', ')}. Ohne diese Felder werden keine Rich Snippets ausgespielt.`,
      description_en: `On ${list.length} page(s), ${type} schemas are missing fields required by Google for Rich Results: ${[...allMissing].join(', ')}. Without these fields, rich snippets are not displayed.`,
      recommendation_de: `Fehlende Felder (${[...allMissing].join(', ')}) im JSON-LD ergänzen. Spezifikation: schema.org/${type} + developers.google.com/search/docs/appearance/structured-data`,
      recommendation_en: `Add the missing fields (${[...allMissing].join(', ')}) to the JSON-LD. Spec: schema.org/${type} + developers.google.com/search/docs/appearance/structured-data`,
      affectedUrl: sampleUrl,
    });
  }

  // 3) Article without headline length check (Google: max 110 chars)
  for (const page of pages) {
    for (const schema of page.schemas) {
      if (!['Article', 'NewsArticle', 'BlogPosting'].includes(schema.type)) continue;
      const headline = schema.data['headline'];
      if (typeof headline === 'string' && headline.length > 110) {
        findings.push({
          id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'low',
          title_de: `Article headline zu lang: ${headline.length} Zeichen`,
          title_en: `Article headline too long: ${headline.length} characters`,
          description_de: 'Google empfiehlt Article-headline <= 110 Zeichen. Längere Werte werden für Rich Results abgeschnitten.',
          description_en: 'Google recommends Article headline <= 110 characters. Longer values are truncated for Rich Results.',
          recommendation_de: 'headline im JSON-LD kürzen.',
          recommendation_en: 'Shorten the headline in the JSON-LD.',
          affectedUrl: page.url,
        });
        break; // one finding per page is enough
      }
    }
  }

  // 4) Offer without price or priceCurrency — frequent mistake
  for (const page of pages) {
    for (const schema of page.schemas) {
      if (schema.type !== 'Product') continue;
      const offers = schema.data['offers'];
      const offerList: Record<string, unknown>[] = Array.isArray(offers)
        ? (offers as Record<string, unknown>[])
        : offers && typeof offers === 'object'
        ? [offers as Record<string, unknown>]
        : [];
      for (const offer of offerList) {
        const missing: string[] = [];
        if (!hasField(offer, 'price')) missing.push('price');
        if (!hasField(offer, 'priceCurrency')) missing.push('priceCurrency');
        if (!hasField(offer, 'availability')) missing.push('availability');
        if (missing.length > 0) {
          findings.push({
            id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
            title_de: `Product/Offer unvollständig: ${missing.join(', ')}`,
            title_en: `Product/Offer incomplete: ${missing.join(', ')}`,
            description_de: 'Product-Rich-Snippets benötigen price, priceCurrency und availability — sonst keine Preis-Anzeige im SERP.',
            description_en: 'Product rich snippets require price, priceCurrency and availability — otherwise no price display in SERP.',
            recommendation_de: `Im offers-Objekt ergänzen: ${missing.join(', ')}. Format: "price": "29.99", "priceCurrency": "EUR", "availability": "https://schema.org/InStock".`,
            recommendation_en: `Add to offers object: ${missing.join(', ')}. Format: "price": "29.99", "priceCurrency": "EUR", "availability": "https://schema.org/InStock".`,
            affectedUrl: page.url,
          });
          break; // one per page
        }
      }
    }
  }

  // BreadcrumbList schema missing on deeper pages
  const deepPagesWithoutBreadcrumb = pages.filter(p =>
    p.depth > 0 &&
    !p.schemas.some(s => s.type === 'BreadcrumbList')
  );
  if (deepPagesWithoutBreadcrumb.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `${deepPagesWithoutBreadcrumb.length} Unter-Seite(n) ohne BreadcrumbList-Schema`,
      title_en: `${deepPagesWithoutBreadcrumb.length} sub-page(s) without BreadcrumbList schema`,
      description_de: `Seiten mit Klicktiefe > 0 haben kein <BreadcrumbList>-JSON-LD. Google zeigt dann keine Breadcrumbs im SERP statt der URL, was die CTR messbar senkt. Beispiele: ${deepPagesWithoutBreadcrumb.slice(0, 3).map(p => p.url).join(', ')}`,
      description_en: `Pages with click depth > 0 have no <BreadcrumbList> JSON-LD. Google then shows the URL instead of breadcrumbs in the SERP, measurably reducing CTR. Examples: ${deepPagesWithoutBreadcrumb.slice(0, 3).map(p => p.url).join(', ')}`,
      recommendation_de: 'BreadcrumbList als JSON-LD auf jeder Unter-Seite ergänzen. Pflichtfelder: itemListElement mit position, name, item.',
      recommendation_en: 'Add BreadcrumbList as JSON-LD on every sub-page. Required fields: itemListElement with position, name, item.',
      affectedUrl: deepPagesWithoutBreadcrumb[0].url,
    });
  }

  return findings;
}


// ============================================================
//  AI CRAWLER READINESS FINDINGS
// ============================================================
export function generateAIReadinessFindings(ai?: AIReadinessInfo): Finding[] {
  const findings: Finding[] = [];
  if (!ai || ai.error) return findings;

  const retrievalBots = ai.bots.filter(b => b.purpose === 'retrieval' || b.purpose === 'search' || b.purpose === 'mixed');
  const blockedRetrieval = retrievalBots.filter(b => b.status === 'blocked');

  // 1) Retrieval/search bots blocked = invisible in ChatGPT, Perplexity, Google AI Overviews
  if (blockedRetrieval.length > 0) {
    const names = blockedRetrieval.map(b => `${b.bot} (${b.vendor})`).join(', ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'high',
      title_de: `AI-Retrieval-Bots blockiert: ${blockedRetrieval.length}`,
      title_en: `AI retrieval bots blocked: ${blockedRetrieval.length}`,
      description_de: `Diese Bots holen Inhalte on-demand für KI-Antworten (ChatGPT, Perplexity, Google AI Overviews). Blockade bedeutet: Die Seite taucht in diesen Antworten nicht auf. Betroffen: ${names}`,
      description_en: `These bots retrieve content on-demand for AI answers (ChatGPT, Perplexity, Google AI Overviews). Blocking them means: the site does not appear in those answers. Affected: ${names}`,
      recommendation_de: 'In robots.txt den Zugriff für Retrieval-Bots explizit erlauben, z.B. "User-agent: ChatGPT-User\\nAllow: /". Unterscheide zwischen Training-Bots (Opt-out sinnvoll) und Retrieval-Bots (Opt-in sinnvoll für Sichtbarkeit).',
      recommendation_en: 'Explicitly allow retrieval bots in robots.txt, e.g. "User-agent: ChatGPT-User\\nAllow: /". Distinguish between training bots (opt-out makes sense) and retrieval bots (opt-in makes sense for visibility).',
    });
  }

  // 2) Wildcard Disallow: / blocks everything including AI bots unintentionally
  if (ai.wildcardBlocksAll) {
    findings.push({
      id: id(), priority: 'critical', module: 'seo', effort: 'low', impact: 'high',
      title_de: 'robots.txt blockiert alle Bots (User-agent: * / Disallow: /)',
      title_en: 'robots.txt blocks all bots (User-agent: * / Disallow: /)',
      description_de: 'Die Wildcard-Regel "Disallow: /" blockiert ALLE Bots — inklusive Googlebot. Das ist fast immer ein Fehler und macht die Seite für die organische Suche unsichtbar.',
      description_en: 'The wildcard rule "Disallow: /" blocks ALL bots — including Googlebot. This is almost always a mistake and makes the site invisible in organic search.',
      recommendation_de: 'Wildcard-Regel sofort entfernen oder auf spezifische Pfade begrenzen. Nur in Staging-Umgebungen akzeptabel.',
      recommendation_en: 'Remove the wildcard rule immediately or restrict to specific paths. Only acceptable in staging environments.',
    });
  }

  // 3) No AI bots mentioned at all — no explicit strategy
  const unspecified = ai.bots.filter(b => b.status === 'unspecified').length;
  const anySpecified = ai.bots.some(b => b.status !== 'unspecified');
  if (!anySpecified && !ai.wildcardBlocksAll) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: 'Keine AI-Crawler-Strategie in robots.txt',
      title_en: 'No AI crawler strategy in robots.txt',
      description_de: `Keiner der ${ai.bots.length} bekannten AI-Bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, ...) ist in robots.txt erwähnt. Ohne explizite Regeln werden die Bots standardmäßig zugelassen — das kann gewünscht sein (Sichtbarkeit in KI-Antworten) oder nicht (Training-Opt-out).`,
      description_en: `None of the ${ai.bots.length} known AI bots (GPTBot, ClaudeBot, PerplexityBot, Google-Extended, ...) are mentioned in robots.txt. Without explicit rules the bots are allowed by default — which may be desired (visibility in AI answers) or not (training opt-out).`,
      recommendation_de: 'Bewusste Entscheidung treffen: Training-Bots (GPTBot, Google-Extended, CCBot, anthropic-ai, Applebot-Extended) ggf. blockieren; Retrieval-Bots (ChatGPT-User, Perplexity-User, OAI-SearchBot, ClaudeBot) erlauben für AI-Sichtbarkeit. Regeln in robots.txt dokumentieren.',
      recommendation_en: 'Make a conscious decision: optionally block training bots (GPTBot, Google-Extended, CCBot, anthropic-ai, Applebot-Extended); allow retrieval bots (ChatGPT-User, Perplexity-User, OAI-SearchBot, ClaudeBot) for AI visibility. Document rules in robots.txt.',
    });
  } else if (unspecified > ai.bots.length / 2 && !ai.wildcardBlocksAll) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `AI-Crawler-Strategie unvollständig: ${unspecified}/${ai.bots.length} Bots nicht abgedeckt`,
      title_en: `AI crawler strategy incomplete: ${unspecified}/${ai.bots.length} bots not covered`,
      description_de: 'Einige AI-Bots sind in robots.txt geregelt, andere nicht. Für eine kohärente Strategie alle relevanten Bots explizit behandeln.',
      description_en: 'Some AI bots are handled in robots.txt, others are not. For a coherent strategy, handle all relevant bots explicitly.',
      recommendation_de: 'robots.txt um Regeln für die fehlenden Bots ergänzen (siehe Liste in der UI).',
      recommendation_en: 'Add rules for the missing bots to robots.txt (see list in the UI).',
    });
  }

  // 4) llms.txt missing — emerging standard for AI-friendly content discovery
  if (!ai.hasLlmsTxt) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: 'llms.txt nicht vorhanden',
      title_en: 'llms.txt not present',
      description_de: '"llms.txt" ist ein entstehender Standard (analog zu robots.txt), der LLMs eine kuratierte Übersicht der wichtigsten Inhalte einer Site bietet. Noch nicht verbreitet, aber hilfreich für AI-Sichtbarkeit.',
      description_en: '"llms.txt" is an emerging standard (similar to robots.txt) that offers LLMs a curated overview of a site\'s most important content. Not widely adopted yet, but helpful for AI visibility.',
      recommendation_de: 'Eine /llms.txt-Datei im Root anlegen mit Markdown-formatierter Inhaltsübersicht (siehe llmstxt.org). Optional /llms-full.txt mit vollständigem Markdown-Content.',
      recommendation_en: 'Create a /llms.txt file in the root with a Markdown-formatted content overview (see llmstxt.org). Optionally /llms-full.txt with full Markdown content.',
    });
  }

  return findings;
}


// ============================================================
//  OPEN GRAPH & TWITTER CARD DEEP FINDINGS (Check 5)
// ============================================================
export function generateOpenGraphFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  const homepage = pages[0];

  // og:image dimensions missing
  const imagesMissingDimensions = pages.filter(p => p.ogImage && (p.ogImageWidth === undefined || p.ogImageHeight === undefined));
  if (imagesMissingDimensions.length > 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `og:image ohne Dimensionen auf ${imagesMissingDimensions.length} Seiten`,
      title_en: `og:image missing dimensions on ${imagesMissingDimensions.length} pages`,
      description_de: 'og:image ist gesetzt, aber og:image:width und og:image:height fehlen. Ohne Dimensionen müssen Social-Plattformen das Bild herunterladen bevor sie die Vorschau rendern können — das verzögert Link-Previews in Slack, LinkedIn und Facebook.',
      description_en: 'og:image is set, but og:image:width and og:image:height are missing. Without dimensions, social platforms must download the image before rendering the preview — this delays link previews on Slack, LinkedIn and Facebook.',
      recommendation_de: 'og:image:width und og:image:height direkt im HTML mitliefern. Empfohlene Größe: 1200x630 Pixel (1.91:1 Ratio).',
      recommendation_en: 'Include og:image:width and og:image:height directly in the HTML. Recommended size: 1200x630 pixels (1.91:1 ratio).',
      affectedUrl: imagesMissingDimensions[0].url,
    });
  }

  // og:image wrong ratio — target 1.91:1 ± 20%
  const TARGET_RATIO = 1.91;
  const TOLERANCE = 0.2;
  const wrongRatio = pages.filter(p => {
    if (!p.ogImageWidth || !p.ogImageHeight || p.ogImageHeight === 0) return false;
    const ratio = p.ogImageWidth / p.ogImageHeight;
    return Math.abs(ratio - TARGET_RATIO) / TARGET_RATIO > TOLERANCE;
  });
  if (wrongRatio.length > 0) {
    const first = wrongRatio[0];
    const ratio = first.ogImageWidth && first.ogImageHeight ? (first.ogImageWidth / first.ogImageHeight).toFixed(2) : '?';
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `og:image mit ungewöhnlichem Seitenverhältnis auf ${wrongRatio.length} Seiten`,
      title_en: `og:image with unusual aspect ratio on ${wrongRatio.length} pages`,
      description_de: `Empfohlenes Seitenverhältnis für og:image ist 1.91:1 (1200x630). Gefunden z.B.: ${ratio}:1 (${first.ogImageWidth}x${first.ogImageHeight}). Plattformen croppen oder skalieren das Bild, was zu unschönen Previews führt.`,
      description_en: `Recommended aspect ratio for og:image is 1.91:1 (1200x630). Found e.g.: ${ratio}:1 (${first.ogImageWidth}x${first.ogImageHeight}). Platforms crop or scale the image, leading to ugly previews.`,
      recommendation_de: 'og:image in 1200x630 exportieren oder zumindest ein Verhältnis nahe 1.91:1 wählen.',
      recommendation_en: 'Export og:image as 1200x630 or at least choose a ratio close to 1.91:1.',
      affectedUrl: first.url,
    });
  }

  // og:locale missing — only flag on homepage level to avoid spam
  if (homepage.ogImage && !homepage.ogLocale) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: 'og:locale fehlt',
      title_en: 'og:locale missing',
      description_de: 'og:locale hilft Plattformen wie Facebook, die richtige Sprache für die Link-Vorschau zu wählen. Ohne Angabe fällt auf en_US zurück, was bei DE-Seiten zu Mix-Ups führen kann.',
      description_en: 'og:locale helps platforms like Facebook pick the right language for link previews. Without it, they fall back to en_US which can cause mismatches on non-English sites.',
      recommendation_de: 'Im <head> ergänzen: <meta property="og:locale" content="de_DE"> (oder der passenden Sprache).',
      recommendation_en: 'Add to <head>: <meta property="og:locale" content="en_US"> (or the matching locale).',
      affectedUrl: homepage.url,
    });
  }

  // twitter:card missing
  const missingTwitterCard = pages.filter(p => !p.twitterCard);
  if (missingTwitterCard.length === pages.length) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: 'Kein twitter:card Tag auf dem gesamten Crawl',
      title_en: 'No twitter:card tag across the entire crawl',
      description_de: 'Ohne twitter:card fällt Twitter/X auf die og:-Tags zurück. Das funktioniert meist, aber ein expliziter twitter:card="summary_large_image" sorgt für bessere Kontrolle über die Darstellung.',
      description_en: 'Without twitter:card, Twitter/X falls back to og: tags. That usually works, but explicit twitter:card="summary_large_image" gives better control over the display.',
      recommendation_de: 'Im <head> ergänzen: <meta name="twitter:card" content="summary_large_image">.',
      recommendation_en: 'Add to <head>: <meta name="twitter:card" content="summary_large_image">.',
      affectedUrl: homepage.url,
    });
  }

  // twitter:image differs from og:image — informational only
  const divergentImages = pages.filter(p => p.ogImage && p.twitterImage && p.ogImage !== p.twitterImage);
  if (divergentImages.length > 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `twitter:image weicht von og:image ab auf ${divergentImages.length} Seiten`,
      title_en: `twitter:image differs from og:image on ${divergentImages.length} pages`,
      description_de: 'twitter:image und og:image sind beide gesetzt, zeigen aber auf unterschiedliche Bilder. Das ist meist unbeabsichtigt und führt dazu, dass Social-Previews je nach Plattform anders aussehen.',
      description_en: 'twitter:image and og:image are both set but point to different images. This is usually unintended and causes social previews to look different depending on platform.',
      recommendation_de: 'Entweder nur og:image setzen (twitter:image wegnehmen) oder beide bewusst identisch halten.',
      recommendation_en: 'Either only set og:image (remove twitter:image) or deliberately keep both identical.',
      affectedUrl: divergentImages[0].url,
    });
  }

  // og:description > 200 chars
  const longDescriptions = pages.filter(p => p.ogDescription && p.ogDescription.length > 200);
  if (longDescriptions.length > 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `og:description zu lang auf ${longDescriptions.length} Seiten`,
      title_en: `og:description too long on ${longDescriptions.length} pages`,
      description_de: 'og:description > 200 Zeichen wird von Facebook und LinkedIn abgeschnitten. Für optimale Vorschauen zwischen 55 und 200 Zeichen halten.',
      description_en: 'og:description > 200 characters is truncated by Facebook and LinkedIn. Keep between 55 and 200 characters for optimal previews.',
      recommendation_de: 'og:description kürzen. Der wichtigste Teil sollte in den ersten 100 Zeichen stehen.',
      recommendation_en: 'Shorten og:description. The most important part should be in the first 100 characters.',
      affectedUrl: longDescriptions[0].url,
    });
  }

  return findings;
}


// ============================================================
//  ROBOTS.TXT CONFLICT FINDINGS (Check 4)
// ============================================================
// Matches the union of User-agent:* and User-agent:Googlebot rule
// groups against crawled URLs using simple prefix matching (the
// robots.txt wildcard spec would need regex; the overwhelming
// majority of real-world rules are plain prefixes).
function getApplicableDisallows(groups: RobotsGroup[]): string[] {
  const relevant = groups.filter(g =>
    g.agents.some(a => a === '*' || a.toLowerCase() === 'googlebot')
  );
  const disallows = relevant.flatMap(g => g.disallows).filter(d => d && d !== '');
  return [...new Set(disallows)];
}

function matchesDisallow(path: string, disallows: string[]): string | undefined {
  for (const rule of disallows) {
    if (rule === '/') return rule;
    if (path.startsWith(rule)) return rule;
  }
  return undefined;
}

const SENSITIVE_PATHS = ['/wp-admin', '/admin', '/login', '/api', '/.env', '/config', '/phpmyadmin'];

export function generateRobotsConflictFindings(
  pages: PageSEOData[],
  robotsContent: string | undefined,
  sitemap?: SitemapInfo
): Finding[] {
  const findings: Finding[] = [];
  if (!robotsContent) return findings;

  const groups = parseRobotsTxt(robotsContent);
  const disallows = getApplicableDisallows(groups);
  if (disallows.length === 0) {
    // Still check sensitive-path coverage — if robots.txt exists but
    // doesn't cover anything sensitive, that's worth noting.
    const uncovered = SENSITIVE_PATHS.filter(p => !matchesDisallow(p, disallows));
    if (uncovered.length === SENSITIVE_PATHS.length) return findings;
  }

  // 1) Crawled URLs that are disallowed but lack noindex
  const disallowedCrawled: { url: string; rule: string }[] = [];
  for (const p of pages) {
    try {
      const path = new URL(p.url).pathname;
      const matchedRule = matchesDisallow(path, disallows);
      if (matchedRule && !p.hasNoindex) {
        disallowedCrawled.push({ url: p.url, rule: matchedRule });
      }
    } catch {}
  }
  if (disallowedCrawled.length > 0) {
    const sample = disallowedCrawled.slice(0, 5).map(x => `${x.url} (disallowed by "${x.rule}")`).join('; ');
    findings.push({
      id: id(), priority: 'critical', module: 'seo', effort: 'medium', impact: 'high',
      title_de: `${disallowedCrawled.length} gecrawlte Seiten durch robots.txt blockiert ohne noindex`,
      title_en: `${disallowedCrawled.length} crawled pages blocked by robots.txt without noindex`,
      description_de: `Diese Seiten sind über interne Links erreichbar, werden aber in robots.txt disallowed. Fehlt zusätzlich der noindex-Tag, kann Google die URL trotzdem aus Backlinks kennen und ohne Inhalt indexieren ("indexed, though blocked by robots.txt" in Search Console). Beispiele: ${sample}`,
      description_en: `These pages are reachable via internal links but are disallowed in robots.txt. Without an additional noindex tag, Google may still know the URL from backlinks and index it without content ("indexed, though blocked by robots.txt" in Search Console). Examples: ${sample}`,
      recommendation_de: 'Entweder den Disallow-Eintrag entfernen (wenn die Seite ranken soll) ODER zusätzlich einen noindex-Meta-Tag setzen (wenn sie wirklich raus soll — dann aber die robots.txt-Regel entfernen, damit Google den noindex lesen kann).',
      recommendation_en: 'Either remove the disallow entry (if the page should rank) OR add a noindex meta tag (if it really should be excluded — then remove the robots.txt rule so Google can read the noindex).',
      affectedUrl: disallowedCrawled[0].url,
    });
  }

  // 2) Sitemap URLs blocked by robots.txt
  if (sitemap && sitemap.urls.length > 0) {
    const sitemapBlocked: { url: string; rule: string }[] = [];
    for (const entry of sitemap.urls) {
      try {
        const path = new URL(entry.url).pathname;
        const rule = matchesDisallow(path, disallows);
        if (rule) sitemapBlocked.push({ url: entry.url, rule });
      } catch {}
    }
    if (sitemapBlocked.length > 0) {
      const sample = sitemapBlocked.slice(0, 5).map(x => `${x.url} (rule: ${x.rule})`).join('; ');
      findings.push({
        id: id(), priority: 'critical', module: 'seo', effort: 'medium', impact: 'high',
        title_de: `${sitemapBlocked.length} Sitemap-URLs durch robots.txt blockiert`,
        title_en: `${sitemapBlocked.length} sitemap URLs blocked by robots.txt`,
        description_de: `Widersprüchliche Signale: Die Sitemap meldet diese URLs als indexierungswürdig, robots.txt blockt sie aber. Google wertet das als Konfigurationsfehler und rankt sie schlechter. Beispiele: ${sample}`,
        description_en: `Conflicting signals: the sitemap lists these URLs as worth indexing, but robots.txt blocks them. Google treats this as a configuration error and ranks them worse. Examples: ${sample}`,
        recommendation_de: 'Entscheiden: soll die URL indexiert werden? → Disallow entfernen. Soll sie nicht? → aus der Sitemap entfernen. Beides gleichzeitig ist immer ein Fehler.',
        recommendation_en: 'Decide: should the URL be indexed? → remove the disallow. Should it not? → remove it from the sitemap. Both at the same time is always a bug.',
      });
    }
  }

  // 3) Sensitive paths NOT blocked by robots.txt
  const unprotected = SENSITIVE_PATHS.filter(p => !matchesDisallow(p, disallows));
  if (unprotected.length > 0 && unprotected.length < SENSITIVE_PATHS.length) {
    // Only flag when some (but not all) are unprotected — if none are set at all
    // the site probably doesn't use any of these paths.
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'low', impact: 'medium',
      title_de: `Sensitive Pfade nicht durch robots.txt geschützt: ${unprotected.join(', ')}`,
      title_en: `Sensitive paths not protected by robots.txt: ${unprotected.join(', ')}`,
      description_de: 'robots.txt blockt einige Standardpfade bereits, diese potenziell sensiblen Pfade aber nicht. Suchmaschinen und Scraper crawlen sie damit weiterhin — bei Admin-/Login-Pfaden ist das ein Security-Hinweis (kein Schutz, aber weniger Exposure).',
      description_en: 'robots.txt already blocks some standard paths, but not these potentially sensitive ones. Search engines and scrapers keep crawling them — for admin/login paths this is a security hint (not a protection, but less exposure).',
      recommendation_de: 'Disallow-Regeln für die genannten Pfade ergänzen (falls die Site sie tatsächlich nutzt). Zur Klarstellung: robots.txt ist KEIN Zugriffsschutz — sensible Bereiche gehören zusätzlich hinter Authentifizierung.',
      recommendation_en: 'Add disallow rules for the listed paths (if the site actually uses them). To be clear: robots.txt is NOT access protection — sensitive areas additionally belong behind authentication.',
    });
  }

  return findings;
}


// ============================================================
//  ANCHOR TEXT FINDINGS (Check 3)
// ============================================================
export function generateAnchorTextFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // Aggregate across the crawl
  const allGeneric: { text: string; href: string; from: string }[] = [];
  let totalEmpty = 0;
  const pagesWithGeneric: PageSEOData[] = [];
  const pagesWithEmpty: PageSEOData[] = [];

  for (const p of pages) {
    if (p.genericAnchors.length > 2) pagesWithGeneric.push(p);
    for (const a of p.genericAnchors) {
      allGeneric.push({ text: a.text, href: a.href, from: p.url });
    }
    if (p.emptyAnchors > 0) {
      totalEmpty += p.emptyAnchors;
      pagesWithEmpty.push(p);
    }
  }

  if (pagesWithGeneric.length > 0) {
    const sample = allGeneric
      .slice(0, 5)
      .map(a => `"${a.text}" → ${a.href}`)
      .join('; ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `Generische Ankertexte auf ${pagesWithGeneric.length} Seiten (${allGeneric.length} gesamt)`,
      title_en: `Generic anchor texts on ${pagesWithGeneric.length} pages (${allGeneric.length} total)`,
      description_de: `Viele interne Links verwenden unspezifische Ankertexte wie "hier klicken", "mehr erfahren", "weiterlesen". Google bewertet Ankertexte als Ranking-Signal — sie sollten beschreiben, worum es auf der Zielseite geht. Beispiele: ${sample}`,
      description_en: `Many internal links use non-specific anchor texts like "click here", "read more", "learn more". Google evaluates anchor texts as a ranking signal — they should describe what the target page is about. Examples: ${sample}`,
      recommendation_de: 'Ankertexte durch beschreibende Phrasen ersetzen. Statt "mehr erfahren" → "zur Preisseite", statt "hier klicken" → "SEO-Audit-Report herunterladen". Keyword in den Ankertext einbauen wenn thematisch passend.',
      recommendation_en: 'Replace anchor texts with descriptive phrases. Instead of "learn more" → "view pricing page", instead of "click here" → "download SEO audit report". Include keywords in the anchor when topically relevant.',
    });
  }

  if (totalEmpty > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `Links ohne Ankertext: ${totalEmpty} auf ${pagesWithEmpty.length} Seiten`,
      title_en: `Links without anchor text: ${totalEmpty} on ${pagesWithEmpty.length} pages`,
      description_de: 'Diese internen Links haben weder Text-Inhalt noch aria-label, title oder alt-Text auf einem Bild-Kind. Screenreader können sie nicht ansagen, Google kann sie nicht mit einem Ranking-Signal verbinden, und sie sind ein Accessibility-Problem (WCAG 2.4.4).',
      description_en: 'These internal links have no text content, no aria-label, no title, and no alt text on a child image. Screen readers cannot announce them, Google cannot attach a ranking signal to them, and they are an accessibility problem (WCAG 2.4.4).',
      recommendation_de: 'Jedem Link einen beschreibenden Text geben. Bei Icon-Links: aria-label="Aktion beschreiben" ergänzen. Bei Bild-Links: img mit alt-Text nutzen.',
      recommendation_en: 'Give every link a descriptive text. For icon links: add aria-label="describe action". For image links: use img with alt text.',
      affectedUrl: pagesWithEmpty[0]?.url,
    });
  }

  return findings;
}


// ============================================================
//  SITEMAP QUALITY FINDINGS (Check 6)
// ============================================================
// Rates a sitemap beyond mere existence: lastmod freshness on
// non-static pages, presence of changefreq/priority, homepage
// priority, and whether a sitemap index should be used once
// the URL count grows beyond the practical single-file limit.
const STATIC_PAGE_PATH_HINTS = [
  '/impressum', '/imprint', '/privacy', '/datenschutz',
  '/about', '/ueber', '/terms', '/agb', '/contact', '/kontakt',
];

function isLikelyStaticPage(urlStr: string): boolean {
  try {
    const path = new URL(urlStr).pathname.toLowerCase();
    return STATIC_PAGE_PATH_HINTS.some(hint => path.includes(hint));
  } catch {
    return false;
  }
}

export function generateSitemapQualityFindings(
  sitemap: SitemapInfo | undefined,
  startUrl: string
): Finding[] {
  const findings: Finding[] = [];
  if (!sitemap || sitemap.error || sitemap.urls.length === 0) return findings;

  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  // 1) Stale lastmod on non-static pages
  const staleEntries = sitemap.urls.filter(e => {
    if (!e.lastmod) return false;
    if (isLikelyStaticPage(e.url)) return false;
    const ts = Date.parse(e.lastmod);
    if (Number.isNaN(ts)) return false;
    return now - ts > ONE_YEAR_MS;
  });
  if (staleEntries.length > 0) {
    const sample = staleEntries.slice(0, 3).map(e => `${e.url} (${e.lastmod})`).join('; ');
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'medium', impact: 'low',
      title_de: `${staleEntries.length} Sitemap-Einträge mit lastmod > 1 Jahr`,
      title_en: `${staleEntries.length} sitemap entries with lastmod > 1 year old`,
      description_de: `Diese URLs haben sich laut Sitemap seit mehr als einem Jahr nicht geändert. Für statische Seiten (Impressum, AGB) ist das in Ordnung, aber die hier gelisteten sind keine offensichtlich statischen Pfade. Beispiele: ${sample}`,
      description_en: `According to the sitemap, these URLs have not changed in more than a year. That's fine for static pages (imprint, terms) but the ones listed here are not obviously static paths. Examples: ${sample}`,
      recommendation_de: 'Prüfen ob der Inhalt tatsächlich so alt ist — wenn ja, Seite aktualisieren oder sauber durch noindex/410 vom Index nehmen. Wenn nein, Sitemap-Generator prüfen (lastmod wird offenbar nicht aktualisiert).',
      recommendation_en: 'Check whether the content really is that old — if yes, refresh the page or cleanly remove via noindex/410. If no, check the sitemap generator (lastmod is apparently not being updated).',
    });
  }

  // 2) No changefreq at all
  const withChangefreq = sitemap.urls.filter(e => !!e.changefreq).length;
  if (withChangefreq === 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: 'Sitemap ohne changefreq-Einträge',
      title_en: 'Sitemap has no changefreq entries',
      description_de: 'Kein einziger Sitemap-Eintrag hat ein <changefreq>-Element. Google ignoriert changefreq inzwischen weitgehend, andere Suchmaschinen nutzen es aber noch als Hinweis auf die Crawl-Frequenz.',
      description_en: 'Not a single sitemap entry has a <changefreq> element. Google largely ignores changefreq these days, but other search engines still use it as a crawl-frequency hint.',
      recommendation_de: 'Optional ergänzen: <changefreq>daily</changefreq> für News-Startseiten, <changefreq>weekly</changefreq> für Blog-Listen, <changefreq>yearly</changefreq> für statische Seiten.',
      recommendation_en: 'Optionally add: <changefreq>daily</changefreq> for news landings, <changefreq>weekly</changefreq> for blog lists, <changefreq>yearly</changefreq> for static pages.',
    });
  }

  // 3) Homepage priority low or missing
  let startPath = '/';
  try { startPath = new URL(startUrl).pathname || '/'; } catch {}
  const homepageEntry = sitemap.urls.find(e => {
    try {
      const p = new URL(e.url).pathname;
      return p === '/' || p === startPath;
    } catch {
      return false;
    }
  });
  if (homepageEntry && (homepageEntry.priority === undefined || homepageEntry.priority < 0.8)) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `Homepage-Priority zu niedrig: ${homepageEntry.priority ?? 'fehlt'}`,
      title_en: `Homepage priority too low: ${homepageEntry.priority ?? 'missing'}`,
      description_de: 'Die Homepage sollte die höchste Priority im Sitemap haben (1.0) — sie ist der wichtigste Einstiegspunkt der Site. Aktueller Wert suggeriert, dass sie weniger wichtig wäre als andere URLs.',
      description_en: 'The homepage should have the highest priority in the sitemap (1.0) — it is the most important entry point of the site. The current value suggests it is less important than other URLs.',
      recommendation_de: 'Im Sitemap-Generator: priority der Homepage auf 1.0 setzen. Achtung: priority ist ein RELATIVES Signal innerhalb deiner Sitemap, Google interpretiert es nicht absolut.',
      recommendation_en: 'In the sitemap generator: set homepage priority to 1.0. Note: priority is a RELATIVE signal within your sitemap; Google does not interpret it absolutely.',
      affectedUrl: homepageEntry.url,
    });
  }

  // 4) Too many URLs in a single sitemap without index
  if (!sitemap.isIndex && sitemap.urls.length > 100) {
    // Only informational for 100+, but recommendation kicks in near 50k (hard spec limit)
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'medium', impact: 'low',
      title_de: `${sitemap.urls.length} URLs in einer einzelnen Sitemap ohne Index`,
      title_en: `${sitemap.urls.length} URLs in a single sitemap without index`,
      description_de: 'Die Sitemap enthält viele URLs, ist aber kein Sitemap-Index. Ab 50 000 URLs / 50 MB ist der Wechsel zu einem Sitemap-Index technisch erforderlich. Schon vorher vereinfacht er die Verwaltung und erlaubt thematische Gruppierung (pages / posts / products / news).',
      description_en: 'The sitemap contains many URLs but is not a sitemap index. Above 50,000 URLs / 50 MB, switching to a sitemap index is technically required. Even earlier, it simplifies management and allows topical grouping (pages / posts / products / news).',
      recommendation_de: 'Sitemap-Generator auf Multi-File-Output umstellen. Typisches Muster: /sitemap.xml (Index) → /sitemap-pages.xml, /sitemap-posts.xml, /sitemap-products.xml.',
      recommendation_en: 'Switch the sitemap generator to multi-file output. Typical pattern: /sitemap.xml (index) → /sitemap-pages.xml, /sitemap-posts.xml, /sitemap-products.xml.',
    });
  }

  return findings;
}


// ============================================================
//  SITEMAP COVERAGE FINDINGS (Check 1)
// ============================================================
// Cross-references crawled URLs against sitemap URLs to find gaps:
// - URLs in sitemap but not crawled (potentially orphan / badly linked)
// - URLs crawled but not in sitemap (sitemap out of date)
// Also emits optional findings for lastmod + image-sitemap absence.
export function generateSitemapCoverageFindings(pages: PageSEOData[], sitemap?: SitemapInfo): Finding[] {
  const findings: Finding[] = [];
  if (!sitemap || sitemap.error || sitemap.urls.length === 0) return findings;

  const crawledSet = new Set(pages.map(p => normalizeUrl(p.url)));
  const sitemapSet = new Set(sitemap.urls.map(e => normalizeUrl(e.url)));

  // 1) In sitemap but not crawled → possible orphan
  const notCrawled: string[] = [];
  for (const sUrl of sitemapSet) {
    if (!crawledSet.has(sUrl)) notCrawled.push(sUrl);
  }

  if (notCrawled.length > 0) {
    const sample = notCrawled.slice(0, 5).join(', ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `${notCrawled.length} Sitemap-URLs nicht gecrawlt`,
      title_en: `${notCrawled.length} sitemap URLs not crawled`,
      description_de: `Diese URLs sind in der Sitemap aufgeführt, wurden aber beim Crawl nicht erreicht. Sehr wahrscheinlich Orphan Pages (nicht intern verlinkt) oder defekt. Beispiele: ${sample}`,
      description_en: `These URLs are listed in the sitemap but were not reached during the crawl. Most likely orphan pages (not internally linked) or broken. Examples: ${sample}`,
      recommendation_de: 'Interne Verlinkung prüfen: fehlt ein Menü-Eintrag, ein Hub-Link oder ist die Seite tot? Orphan-Pages sind schwieriger zu ranken, weil kein Linkjuice fließt.',
      recommendation_en: 'Check internal linking: is a menu entry missing, a hub link broken, or is the page dead? Orphan pages are harder to rank because no link equity flows to them.',
    });
  }

  // 2) Crawled but not in sitemap
  const notInSitemap: string[] = [];
  for (const cUrl of crawledSet) {
    if (!sitemapSet.has(cUrl)) notInSitemap.push(cUrl);
  }

  if (notInSitemap.length > 0) {
    const ratio = notInSitemap.length / Math.max(crawledSet.size, 1);
    const priority: 'important' | 'recommended' = ratio > 0.1 ? 'important' : 'recommended';
    const sample = notInSitemap.slice(0, 5).join(', ');
    findings.push({
      id: id(), priority, module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${notInSitemap.length} gecrawlte Seiten fehlen in der Sitemap`,
      title_en: `${notInSitemap.length} crawled pages missing from sitemap`,
      description_de: `${Math.round(ratio * 100)}% der gecrawlten Seiten sind nicht in der Sitemap enthalten. Google findet sie so zwar über interne Links, die Sitemap beschleunigt die Indexierung aber deutlich. Beispiele: ${sample}`,
      description_en: `${Math.round(ratio * 100)}% of crawled pages are missing from the sitemap. Google will still find them via internal links, but the sitemap accelerates indexing considerably. Examples: ${sample}`,
      recommendation_de: 'Sitemap-Generator so konfigurieren, dass alle indexierbaren Seiten automatisch aufgenommen werden. Bei statischen Generatoren: Build-Hook prüfen.',
      recommendation_en: 'Configure the sitemap generator to automatically include all indexable pages. For static generators: check the build hook.',
    });
  }

  // 3) lastmod missing — any lastmod at all?
  const withLastmod = sitemap.urls.filter(e => !!e.lastmod).length;
  if (withLastmod === 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: 'Sitemap ohne lastmod-Einträge',
      title_en: 'Sitemap has no lastmod entries',
      description_de: 'Kein einziger Sitemap-Eintrag hat ein <lastmod>-Element. Google nutzt lastmod, um zu entscheiden, welche Seiten neu gecrawlt werden — ohne Angabe werden Seiten seltener besucht.',
      description_en: 'Not a single sitemap entry has a <lastmod> element. Google uses lastmod to decide which pages to recrawl — without it, pages are visited less often.',
      recommendation_de: 'Sitemap-Generator so konfigurieren, dass er pro URL das letzte Änderungsdatum setzt. Bei statischen Sites: Build-Timestamp oder Git-Commit-Datum.',
      recommendation_en: 'Configure the sitemap generator to set the last-modified date per URL. For static sites: use build timestamp or git commit date.',
    });
  }

  // 4) Image sitemap missing for sites with images
  const hasImages = pages.some(p => p.totalImages > 0);
  const sitemapHasImages = sitemap.urls.some(e => e.imageCount > 0);
  if (hasImages && !sitemapHasImages) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'medium', impact: 'low',
      title_de: 'Sitemap enthält keine Bild-Einträge',
      title_en: 'Sitemap contains no image entries',
      description_de: 'Die Site enthält Bilder, aber die Sitemap hat kein <image:image>-Element. Google Images indexiert Bilder zwar auch ohne, die explizite Angabe beschleunigt die Aufnahme und liefert zusätzliche Metadaten.',
      description_en: 'The site contains images but the sitemap has no <image:image> element. Google Images indexes images even without it, but explicit declaration speeds up inclusion and provides additional metadata.',
      recommendation_de: 'Image-Sitemap-Protokoll einbinden (xmlns:image="http://www.google.com/schemas/sitemap-image/1.1") und pro URL die zugehörigen Bild-Locs auflisten.',
      recommendation_en: 'Include the image sitemap protocol (xmlns:image="http://www.google.com/schemas/sitemap-image/1.1") and list image locations per URL.',
    });
  }

  return findings;
}


export function generateRichResultsFindings(pages: PageSEOData[], pageSpeed?: PageSpeedData): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  const anySchemas = pages.some(p => p.schemas.length > 0);
  if (!anySchemas) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'high',
      title_de: 'Keine strukturierten Daten (JSON-LD) gefunden',
      title_en: 'No structured data (JSON-LD) found',
      description_de: 'Auf keiner gecrawlten Seite wurde Schema.org-Markup gefunden. Strukturierte Daten sind die Grundlage für Google Rich Results (Sterne-Bewertungen, FAQ-Snippets, Breadcrumb-Darstellung im SERP) und deutliche CTR-Booster.',
      description_en: 'No Schema.org markup was found on any crawled page. Structured data is the foundation for Google Rich Results (star ratings, FAQ snippets, breadcrumb display in SERP) and a significant CTR booster.',
      recommendation_de: 'Mindestens Organization auf der Startseite, BreadcrumbList site-weit und ein passender Typ pro Page (Article / Product / Service / LocalBusiness) als JSON-LD ergänzen. Mit dem Google Rich Results Test validieren.',
      recommendation_en: 'Add at least Organization on the homepage, BreadcrumbList site-wide, and a matching type per page (Article / Product / Service / LocalBusiness) as JSON-LD. Validate with the Google Rich Results Test.',
    });
  }

  if (pageSpeed?.structuredDataAuditWarning) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'low', impact: 'medium',
      title_de: 'PageSpeed Insights meldet Probleme mit strukturierten Daten',
      title_en: 'PageSpeed Insights reports structured data issues',
      description_de: `Lighthouse-Audit "structured-data": ${pageSpeed.structuredDataAuditWarning}. Dies bedeutet, dass Google die Daten zwar findet, aber syntaktische oder semantische Fehler erkennt, die Rich Results verhindern können.`,
      description_en: `Lighthouse "structured-data" audit: ${pageSpeed.structuredDataAuditWarning}. This means Google finds the data but detects syntactic or semantic errors that may prevent rich results.`,
      recommendation_de: 'Mit dem Google Rich Results Test (search.google.com/test/rich-results) validieren und die gemeldeten Fehler beheben.',
      recommendation_en: 'Validate with Google Rich Results Test (search.google.com/test/rich-results) and fix reported errors.',
    });
  }

  return findings;
}

// ============================================================
//  URL QUALITY FINDINGS (Block D1)
// ============================================================
export function generateURLQualityFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // 1) URLs longer than 115 characters
  const longUrls = pages.filter(p => p.url.length > 115);
  if (longUrls.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'high', impact: 'low',
      title_de: `${longUrls.length} URL(s) länger als 115 Zeichen`,
      title_en: `${longUrls.length} URL(s) longer than 115 characters`,
      description_de: `Lange URLs sind schlecht teilbar und schwerer im SERP zu lesen. Beispiele: ${longUrls.slice(0, 2).map(p => `${p.url.slice(0, 80)}… (${p.url.length})`).join(', ')}`,
      description_en: `Long URLs are hard to share and harder to read in SERPs. Examples: ${longUrls.slice(0, 2).map(p => `${p.url.slice(0, 80)}… (${p.url.length})`).join(', ')}`,
      recommendation_de: 'Slug-Struktur vereinfachen, überflüssige Verzeichnisebenen entfernen, Query-Parameter bei kanonischen URLs vermeiden.',
      recommendation_en: 'Simplify slug structure, remove unnecessary directory levels, avoid query parameters on canonical URLs.',
    });
  }

  // 2) URLs with uppercase letters in the path
  const uppercaseUrls = pages.filter(p => {
    try {
      const path = new URL(p.url).pathname;
      return /[A-Z]/.test(path);
    } catch {
      return false;
    }
  });
  if (uppercaseUrls.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'medium', impact: 'low',
      title_de: `${uppercaseUrls.length} URL(s) mit Großbuchstaben im Pfad`,
      title_en: `${uppercaseUrls.length} URL(s) with uppercase letters in the path`,
      description_de: `Großbuchstaben in Pfaden führen auf manchen Servern zu 404 (case-sensitive), und Google behandelt /About und /about potenziell als unterschiedliche URLs. Beispiele: ${uppercaseUrls.slice(0, 3).map(p => p.url).join(', ')}`,
      description_en: `Uppercase letters in paths cause 404s on case-sensitive servers and Google may treat /About and /about as distinct URLs. Examples: ${uppercaseUrls.slice(0, 3).map(p => p.url).join(', ')}`,
      recommendation_de: 'Alle URLs in Kleinbuchstaben umstellen. 301-Redirects von den alten Großbuchstaben-Varianten auf die kleinen einrichten.',
      recommendation_en: 'Convert all URLs to lowercase. Set up 301 redirects from the old uppercase variants to the lowercase versions.',
    });
  }

  // 3) URLs with query parameters but no canonical
  const queryNoCanonical = pages.filter(p => {
    if (!p.url.includes('?')) return false;
    return !p.hasCanonical;
  });
  if (queryNoCanonical.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `${queryNoCanonical.length} URL(s) mit Query-Parametern ohne Canonical`,
      title_en: `${queryNoCanonical.length} URL(s) with query parameters but no canonical`,
      description_de: `URLs mit Query-Parametern (?...) ohne Canonical-Tag erzeugen unzählige Duplikate im Google-Index (eine pro Kombination). Beispiele: ${queryNoCanonical.slice(0, 3).map(p => p.url).join(', ')}`,
      description_en: `URLs with query parameters (?...) without a canonical tag create countless duplicates in Google's index (one per combination). Examples: ${queryNoCanonical.slice(0, 3).map(p => p.url).join(', ')}`,
      recommendation_de: 'Auf URLs mit Query-Parametern immer einen Canonical auf die parameterlose Haupt-URL setzen (außer bei echten Paginations-Seiten — die brauchen self-canonical).',
      recommendation_en: 'Always set a canonical on URLs with query parameters pointing to the parameter-less main URL (except for genuine pagination pages — those need self-canonical).',
    });
  }

  // 4) URLs with #fragment (defensive check — crawler normally drops them)
  const fragmentUrls = pages.filter(p => p.url.includes('#'));
  if (fragmentUrls.length > 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `${fragmentUrls.length} URL(s) mit #-Fragment gecrawlt`,
      title_en: `${fragmentUrls.length} URL(s) with #-fragment crawled`,
      description_de: `Fragment-URLs werden von Suchmaschinen ignoriert (nur Client-Seite relevant). Dass sie im Crawl auftauchen, deutet auf ein Verlinkungs- oder Normalisierungsproblem hin. Beispiele: ${fragmentUrls.slice(0, 2).map(p => p.url).join(', ')}`,
      description_en: `Fragment URLs are ignored by search engines (client-side only). Their presence in the crawl indicates a linking or normalisation issue. Examples: ${fragmentUrls.slice(0, 2).map(p => p.url).join(', ')}`,
      recommendation_de: 'Interne Links auf die URLs ohne #-Fragment umstellen. Crawler-Normalisierung prüfen.',
      recommendation_en: 'Switch internal links to the URLs without #-fragments. Check crawler normalisation logic.',
    });
  }

  return findings;
}


// ============================================================
//  PIXEL-WIDTH FINDINGS (Title / Meta Description SERP truncation)
// ============================================================
// Character count is a poor predictor of SERP truncation: an "i"-heavy
// title fits where a "W"-heavy one of the same length wouldn't. These
// findings complement the char-count checks rather than replacing them
// because the two thresholds catch different mistakes (a 70-char title
// of "iiiii…" trips char-length but not pixel-width; a 50-char title of
// "WWWWW…" trips pixel-width but not char-length).
export function generatePixelWidthFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // 1) Title pixel overrun (mobile threshold = 580px, the stricter cut)
  const longTitles = pages.filter(p =>
    p.titlePixelWidth !== undefined && p.titlePixelWidth > TITLE_LIMIT_MOBILE_PX
  );
  if (longTitles.length > 0) {
    const sample = longTitles
      .slice(0, 3)
      .map(p => `"${p.title}" (${p.titlePixelWidth}px / ${p.titleLength} Z.)`)
      .join('; ');
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${longTitles.length} Title-Tag(s) zu breit für die mobile SERP (>${TITLE_LIMIT_MOBILE_PX}px)`,
      title_en: `${longTitles.length} title tag(s) too wide for the mobile SERP (>${TITLE_LIMIT_MOBILE_PX}px)`,
      description_de: `Der Title wird in Google's mobiler SERP bei ca. ${TITLE_LIMIT_MOBILE_PX}px abgeschnitten — Zeichenanzahl ist eine ungenaue Annäherung, weil "W" mehr als dreimal so breit rendert wie "i". Beispiele: ${sample}`,
      description_en: `Titles are clipped at roughly ${TITLE_LIMIT_MOBILE_PX}px in Google's mobile SERP — character count is a rough approximation because "W" renders more than 3× as wide as "i". Examples: ${sample}`,
      recommendation_de: 'Title kürzen oder mit schmaleren Wörtern umformulieren. Faustregel: Brand am Ende mit "|"-Separator weglassen oder durch "-" ersetzen, "Großbuchstaben"-Wörter prüfen.',
      recommendation_en: 'Shorten the title or rephrase using narrower words. Rule of thumb: drop the trailing brand suffix after "|" or use "-" instead, and audit ALL-CAPS words.',
      affectedUrl: longTitles[0].url,
    });
  }

  // 2) Meta description pixel overrun
  const longDescs = pages.filter(p =>
    p.metaDescriptionPixelWidth !== undefined && p.metaDescriptionPixelWidth > META_DESC_LIMIT_PX
  );
  if (longDescs.length > 0) {
    const sample = longDescs
      .slice(0, 3)
      .map(p => `${p.url} (${p.metaDescriptionPixelWidth}px / ${p.metaDescriptionLength} Z.)`)
      .join('; ');
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${longDescs.length} Meta-Description(s) zu breit für die SERP (>${META_DESC_LIMIT_PX}px)`,
      title_en: `${longDescs.length} meta description(s) too wide for the SERP (>${META_DESC_LIMIT_PX}px)`,
      description_de: `Google schneidet Meta-Descriptions bei ca. ${META_DESC_LIMIT_PX}px ab. Wie beim Title gilt: Zeichenanzahl ist nur eine Näherung, weil unterschiedliche Buchstaben unterschiedlich breit rendern. Beispiele: ${sample}`,
      description_en: `Google clips meta descriptions at roughly ${META_DESC_LIMIT_PX}px. Like for the title, character count is only an approximation because different letters render at different widths. Examples: ${sample}`,
      recommendation_de: 'Description kürzen, sodass die wichtigste Aussage und der Call-to-Action vor dem Schnitt stehen. Bei mehrsprachigen Templates: Pixel-Länge je Sprache messen, weil Übersetzungen oft länger werden.',
      recommendation_en: 'Shorten the description so the key message and call-to-action come before the cut. For multilingual templates: measure pixel-length per language, since translations are usually longer.',
      affectedUrl: longDescs[0].url,
    });
  }

  return findings;
}


// ============================================================
//  X-ROBOTS-TAG FINDINGS
// ============================================================
// X-Robots-Tag in the HTTP response header is functionally equivalent
// to <meta name="robots"> but lives outside the HTML — easy to set
// accidentally via a CDN/edge worker and easy to overlook in audits.
// We surface three shapes:
//   - header noindex (page is excluded from index — the same severity
//     bracket as a missing title; the spec calls this Important)
//   - header/meta conflict (one side excludes the page, the other
//     does not — typically a misconfigured edge / CMS plugin combo)
//   - bot-specific directives (informational — confirms that an
//     audit would otherwise miss bot-prefixed rules entirely)
export function generateXRobotsFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // 1) Header signals noindex
  const noindexed = pages.filter(p => p.xRobotsNoindex);
  if (noindexed.length > 0) {
    const homepageAffected = noindexed.some(p => p.depth === 0);
    const sample = noindexed.slice(0, 5).map(p => `${p.url} (X-Robots-Tag: ${p.xRobotsTag})`).join('; ');
    // Homepage noindex via header is critical — the entire site is excluded.
    const priority: 'critical' | 'important' = homepageAffected ? 'critical' : 'important';
    findings.push({
      id: id(), priority, module: 'seo', effort: 'low', impact: 'high',
      title_de: `X-Robots-Tag setzt noindex auf ${noindexed.length} Seite(n)`,
      title_en: `X-Robots-Tag sets noindex on ${noindexed.length} page(s)`,
      description_de: `Der HTTP-Header "X-Robots-Tag" enthält "noindex" (oder eine Googlebot-spezifische Variante). Diese Seiten werden aus dem Google-Index entfernt — auch wenn das HTML kein <meta name="robots" content="noindex"> enthält. Beispiele: ${sample}`,
      description_en: `The HTTP "X-Robots-Tag" header contains "noindex" (or a Googlebot-specific variant). These pages are removed from Google's index even when the HTML carries no <meta name="robots" content="noindex">. Examples: ${sample}`,
      recommendation_de: 'Server- bzw. CDN-Konfiguration prüfen (nginx add_header, Apache Header set, Cloudflare Worker, Next.js Middleware). Falls die Seiten ranken sollen: den Header entfernen oder auf "all" setzen. Falls sie wirklich raus sollen: zusätzlich <meta robots="noindex"> setzen, damit der Status auch im HTML sichtbar ist.',
      recommendation_en: 'Check server or CDN configuration (nginx add_header, Apache Header set, Cloudflare Worker, Next.js middleware). If the pages should rank: remove the header or set it to "all". If they truly should be excluded: additionally set <meta robots="noindex"> so the status is visible in the HTML.',
      affectedUrl: noindexed[0].url,
    });
  }

  // 2) Header/meta conflict — exactly one side asserts noindex
  // Direction A: header excludes, meta does not
  // Direction B: meta excludes, header is set to something non-noindex
  const conflictPages = pages.filter(p => {
    if (p.xRobotsNoindex && !p.hasNoindex) return true;
    if (!p.xRobotsNoindex && p.hasNoindex && p.xRobotsTag) return true;
    return false;
  });
  if (conflictPages.length > 0) {
    const sample = conflictPages.slice(0, 3).map(p => {
      const headerSays = p.xRobotsNoindex ? 'header=noindex' : `header="${p.xRobotsTag}"`;
      const metaSays = p.hasNoindex ? 'meta=noindex' : 'meta=index';
      return `${p.url} (${headerSays}, ${metaSays})`;
    }).join('; ');
    findings.push({
      id: id(), priority: 'important', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `Widersprüchliche Indexierungs-Signale auf ${conflictPages.length} Seite(n)`,
      title_en: `Conflicting indexability signals on ${conflictPages.length} page(s)`,
      description_de: `<meta name="robots"> und der HTTP-Header "X-Robots-Tag" geben unterschiedliche Direktiven aus. Google folgt der restriktiveren Anweisung — typischerweise gewinnt damit der Header. Das Risiko: ein Entwickler liest nur das HTML, sieht "index" und vermutet die Seite sei indexiert, obwohl ein Header sie blockiert. Beispiele: ${sample}`,
      description_en: `<meta name="robots"> and the HTTP "X-Robots-Tag" header carry different directives. Google obeys the most restrictive one — typically that means the header wins. The risk: a developer reads only the HTML, sees "index" and assumes the page is indexed even though a header blocks it. Examples: ${sample}`,
      recommendation_de: 'Eine Quelle als Wahrheit definieren (üblicherweise das <meta>-Tag) und die andere konsistent angleichen. CDN-/Edge-Worker auf "Header-Mutationen" prüfen, da sie häufig stillschweigend X-Robots-Tag setzen.',
      recommendation_en: 'Pick one source of truth (usually the <meta> tag) and align the other consistently. Audit CDN/edge workers for header mutations — they often set X-Robots-Tag silently.',
      affectedUrl: conflictPages[0].url,
    });
  }

  // 3) Bot-specific directives — informational
  const botSpecific = pages.filter(p => p.xRobotsBotSpecific.length > 0);
  if (botSpecific.length > 0) {
    const summary = new Map<string, number>();
    for (const p of botSpecific) {
      for (const entry of p.xRobotsBotSpecific) {
        summary.set(entry.bot, (summary.get(entry.bot) ?? 0) + 1);
      }
    }
    const breakdown = [...summary.entries()].map(([bot, count]) => `${bot} (${count})`).join(', ');
    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'low',
      title_de: `Bot-spezifische X-Robots-Tag Direktiven erkannt: ${breakdown}`,
      title_en: `Bot-specific X-Robots-Tag directives detected: ${breakdown}`,
      description_de: `Auf ${botSpecific.length} Seite(n) sind bot-präfixte Direktiven gesetzt (z.B. "googlebot: noindex"). Das ist kein Fehler — aber eine bewusste Wahl: stelle sicher, dass die Bot-Liste vollständig ist und keine wichtigen Crawler vergessen wurden (Bingbot, Applebot, Bots für KI-Antworten).`,
      description_en: `On ${botSpecific.length} page(s) bot-prefixed directives are set (e.g. "googlebot: noindex"). This isn't an error — but it's a deliberate choice: make sure the bot list is complete and no important crawler is forgotten (Bingbot, Applebot, AI-answer bots).`,
      recommendation_de: 'Pro betroffener URL die Bot-Liste prüfen und ggf. um die fehlenden Bots ergänzen. Als Alternative bietet sich "X-Robots-Tag: noindex" (ohne Prefix) an, wenn dieselbe Regel für alle gelten soll.',
      recommendation_en: 'For each affected URL, review the bot list and add missing bots where needed. As an alternative use "X-Robots-Tag: noindex" (no prefix) when the same rule should apply universally.',
      affectedUrl: botSpecific[0].url,
    });
  }

  return findings;
}

