// ============================================================
//  SEO AUDIT — KRITERIENKATALOG
//  Diese Datei ist die einzige Quelle für alle Prüfkriterien.
//  Ändere hier Gewichtungen, Beschreibungen oder füge neue
//  Kriterien hinzu. Gleiche URL = gleicher Score, solange
//  diese Datei unverändert bleibt.
// ============================================================

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface Criterion {
  id: string;
  name_de: string;
  name_en: string;
  description_de: string; // was wird geprüft
  description_en: string;
  max_points: number;    // maximal erreichbare Punkte
  category: string;
}

export interface Category {
  id: string;
  name_de: string;
  name_en: string;
  criteria: Criterion[];
}

// ============================================================
//  KATEGORIEN & KRITERIEN
//  max_points bestimmt die Gewichtung im Gesamtscore.
//  Summe aller max_points = 100 Punkte gesamt.
// ============================================================

export const AUDIT_CATEGORIES: Category[] = [
  {
    id: 'technical',
    name_de: 'Technisches SEO',
    name_en: 'Technical SEO',
    criteria: [
      {
        id: 'https',
        name_de: 'HTTPS / SSL',
        name_en: 'HTTPS / SSL',
        description_de: 'Die Seite muss über HTTPS erreichbar sein. HTTP-Verbindungen werden von Google als unsicher markiert und schlechter gerankt.',
        description_en: 'The page must be accessible via HTTPS. HTTP connections are flagged as insecure by Google and ranked lower.',
        max_points: 5,
        category: 'technical',
      },
      {
        id: 'www_redirect',
        name_de: 'WWW-Weiterleitung konsistent',
        name_en: 'Consistent WWW redirect',
        description_de: 'Entweder www.domain.de oder domain.de sollte kanonisch sein und die andere Variante weiterleiten (301).',
        description_en: 'Either www.domain.com or domain.com should be canonical, with the other redirecting (301).',
        max_points: 3,
        category: 'technical',
      },
      {
        id: 'robots_txt',
        name_de: 'robots.txt vorhanden',
        name_en: 'robots.txt present',
        description_de: 'Eine robots.txt muss unter /robots.txt erreichbar sein und darf wichtige Seiten nicht blockieren.',
        description_en: 'A robots.txt must be accessible at /robots.txt and must not block important pages.',
        max_points: 3,
        category: 'technical',
      },
      {
        id: 'sitemap_xml',
        name_de: 'XML-Sitemap',
        name_en: 'XML Sitemap',
        description_de: 'Eine XML-Sitemap unter /sitemap.xml oder in der robots.txt angegeben hilft Suchmaschinen beim Crawlen.',
        description_en: 'An XML sitemap at /sitemap.xml or referenced in robots.txt helps search engines crawl the site.',
        max_points: 3,
        category: 'technical',
      },
      {
        id: 'canonical_tag',
        name_de: 'Canonical-Tag gesetzt',
        name_en: 'Canonical tag set',
        description_de: 'Jede Seite sollte einen <link rel="canonical"> haben, um Duplicate-Content-Probleme zu vermeiden.',
        description_en: 'Every page should have a <link rel="canonical"> to avoid duplicate content issues.',
        max_points: 3,
        category: 'technical',
      },
      {
        id: 'url_structure',
        name_de: 'Saubere URL-Struktur',
        name_en: 'Clean URL structure',
        description_de: 'URLs sollten lesbar, kurz und keyword-relevant sein. Keine langen Query-Strings, keine Sonderzeichen.',
        description_en: 'URLs should be readable, short, and keyword-relevant. No long query strings, no special characters.',
        max_points: 2,
        category: 'technical',
      },
    ],
  },
  {
    id: 'meta',
    name_de: 'Meta-Tags & Head',
    name_en: 'Meta Tags & Head',
    criteria: [
      {
        id: 'title_tag',
        name_de: 'Title-Tag',
        name_en: 'Title tag',
        description_de: 'Muss vorhanden, einzigartig und 50–60 Zeichen lang sein. Enthält das Haupt-Keyword.',
        description_en: 'Must be present, unique, and 50–60 characters long. Contains the main keyword.',
        max_points: 10,
        category: 'meta',
      },
      {
        id: 'meta_description',
        name_de: 'Meta-Description',
        name_en: 'Meta description',
        description_de: 'Muss vorhanden und 120–160 Zeichen lang sein. Soll zum Klicken animieren und das Keyword enthalten.',
        description_en: 'Must be present and 120–160 characters long. Should encourage clicks and contain the keyword.',
        max_points: 8,
        category: 'meta',
      },
      {
        id: 'og_tags',
        name_de: 'Open Graph Tags (og:title, og:description, og:image)',
        name_en: 'Open Graph tags (og:title, og:description, og:image)',
        description_de: 'OG-Tags steuern die Vorschau beim Teilen in sozialen Netzwerken. Alle drei Pflichtfelder sollten gesetzt sein.',
        description_en: 'OG tags control the preview when sharing on social networks. All three required fields should be set.',
        max_points: 5,
        category: 'meta',
      },
      {
        id: 'twitter_card',
        name_de: 'Twitter/X Card Meta-Tags',
        name_en: 'Twitter/X Card meta tags',
        description_de: 'twitter:card, twitter:title und twitter:description ermöglichen eine optimierte Vorschau auf X/Twitter.',
        description_en: 'twitter:card, twitter:title and twitter:description enable an optimized preview on X/Twitter.',
        max_points: 3,
        category: 'meta',
      },
      {
        id: 'html_lang',
        name_de: 'HTML lang-Attribut',
        name_en: 'HTML lang attribute',
        description_de: 'Das <html>-Tag muss ein korrektes lang-Attribut haben (z.B. lang="de"), damit Suchmaschinen die Sprache erkennen.',
        description_en: 'The <html> tag must have a correct lang attribute (e.g. lang="en") for search engines to identify the language.',
        max_points: 3,
        category: 'meta',
      },
      {
        id: 'viewport_meta',
        name_de: 'Viewport Meta-Tag',
        name_en: 'Viewport meta tag',
        description_de: '<meta name="viewport" content="width=device-width, initial-scale=1"> ist Pflicht für Mobile-Friendly.',
        description_en: '<meta name="viewport" content="width=device-width, initial-scale=1"> is required for mobile-friendly.',
        max_points: 3,
        category: 'meta',
      },
      {
        id: 'charset',
        name_de: 'Charset-Deklaration (UTF-8)',
        name_en: 'Charset declaration (UTF-8)',
        description_de: '<meta charset="UTF-8"> muss im Head stehen, idealerweise als erstes Element.',
        description_en: '<meta charset="UTF-8"> must be in the head, ideally as the first element.',
        max_points: 2,
        category: 'meta',
      },
    ],
  },
  {
    id: 'content',
    name_de: 'Content & Struktur',
    name_en: 'Content & Structure',
    criteria: [
      {
        id: 'h1_tag',
        name_de: 'H1-Tag (einzigartig, vorhanden)',
        name_en: 'H1 tag (unique, present)',
        description_de: 'Genau ein H1-Tag pro Seite. Muss das Haupt-Keyword enthalten und den Seiteninhalt beschreiben.',
        description_en: 'Exactly one H1 tag per page. Must contain the main keyword and describe the page content.',
        max_points: 8,
        category: 'content',
      },
      {
        id: 'heading_hierarchy',
        name_de: 'Überschriften-Hierarchie (H2–H6)',
        name_en: 'Heading hierarchy (H2–H6)',
        description_de: 'H2–H6 strukturieren den Inhalt logisch. Keine Hierarchie-Sprünge (z.B. H1 → H3 überspringt H2).',
        description_en: 'H2–H6 structure content logically. No hierarchy jumps (e.g. H1 → H3 skips H2).',
        max_points: 5,
        category: 'content',
      },
      {
        id: 'image_alt_texts',
        name_de: 'Alt-Texte bei allen Bildern',
        name_en: 'Alt texts for all images',
        description_de: 'Jedes <img>-Tag muss ein nicht-leeres alt-Attribut haben. Dekorative Bilder: alt="".',
        description_en: 'Every <img> tag must have a non-empty alt attribute. Decorative images: alt="".',
        max_points: 5,
        category: 'content',
      },
      {
        id: 'content_length',
        name_de: 'Ausreichend Text-Content',
        name_en: 'Sufficient text content',
        description_de: 'Mindestens 300 Wörter sichtbarer Text pro Seite. Thin Content wird von Google abgewertet.',
        description_en: 'At least 300 words of visible text per page. Thin content is penalized by Google.',
        max_points: 4,
        category: 'content',
      },
      {
        id: 'keyword_in_h1',
        name_de: 'Keyword im H1 erkennbar',
        name_en: 'Keyword visible in H1',
        description_de: 'Das primäre Thema der Seite sollte im H1 explizit erkennbar sein.',
        description_en: 'The primary topic of the page should be explicitly recognizable in the H1.',
        max_points: 3,
        category: 'content',
      },
      {
        id: 'keyword_in_title',
        name_de: 'Keyword im Title-Tag erkennbar',
        name_en: 'Keyword visible in title tag',
        description_de: 'Das primäre Keyword sollte möglichst früh im Title-Tag stehen.',
        description_en: 'The primary keyword should appear as early as possible in the title tag.',
        max_points: 3,
        category: 'content',
      },
    ],
  },
  {
    id: 'performance',
    name_de: 'Performance (geschätzt)',
    name_en: 'Performance (estimated)',
    criteria: [
      {
        id: 'render_blocking',
        name_de: 'Render-blocking Ressourcen',
        name_en: 'Render-blocking resources',
        description_de: 'CSS/JS im <head> ohne async/defer blockiert das Rendering. Externe Scripts sollten async oder defer sein.',
        description_en: 'CSS/JS in the <head> without async/defer blocks rendering. External scripts should be async or defer.',
        max_points: 5,
        category: 'performance',
      },
      {
        id: 'inline_css_js',
        name_de: 'Keine übermäßigen Inline-Styles',
        name_en: 'No excessive inline styles',
        description_de: 'Große Mengen Inline-CSS/JS verhindern Caching und verlangsamen die Seite.',
        description_en: 'Large amounts of inline CSS/JS prevent caching and slow down the page.',
        max_points: 3,
        category: 'performance',
      },
      {
        id: 'image_formats',
        name_de: 'Moderne Bildformate (WebP/AVIF)',
        name_en: 'Modern image formats (WebP/AVIF)',
        description_de: 'WebP- oder AVIF-Bilder sind 25–50% kleiner als JPEG/PNG bei gleicher Qualität.',
        description_en: 'WebP or AVIF images are 25–50% smaller than JPEG/PNG at the same quality.',
        max_points: 4,
        category: 'performance',
      },
      {
        id: 'lazy_loading',
        name_de: 'Lazy Loading bei Bildern',
        name_en: 'Lazy loading for images',
        description_de: 'loading="lazy" bei Bildern below the fold reduziert die initiale Ladezeit erheblich.',
        description_en: 'loading="lazy" on below-the-fold images significantly reduces initial load time.',
        max_points: 3,
        category: 'performance',
      },
    ],
  },
  {
    id: 'mobile',
    name_de: 'Mobile & Zugänglichkeit',
    name_en: 'Mobile & Accessibility',
    criteria: [
      {
        id: 'mobile_viewport',
        name_de: 'Viewport konfiguriert',
        name_en: 'Viewport configured',
        description_de: 'Viewport-Meta-Tag muss gesetzt sein (wird auch unter Meta geprüft, hier bewertet als Mobile-Signal).',
        description_en: 'Viewport meta tag must be set (also checked under Meta, here evaluated as mobile signal).',
        max_points: 3,
        category: 'mobile',
      },
      {
        id: 'no_flash',
        name_de: 'Kein Flash / veraltete Technologien',
        name_en: 'No Flash / outdated technologies',
        description_de: 'Flash, <frame>, <frameset> oder andere veraltete Tags schaden dem SEO und Mobile-Ranking.',
        description_en: 'Flash, <frame>, <frameset> or other outdated tags harm SEO and mobile ranking.',
        max_points: 3,
        category: 'mobile',
      },
      {
        id: 'aria_labels',
        name_de: 'ARIA-Labels / Zugänglichkeit',
        name_en: 'ARIA labels / accessibility',
        description_de: 'ARIA-Attribute und semantisches HTML verbessern die Zugänglichkeit, was ein Google-Rankingfaktor ist.',
        description_en: 'ARIA attributes and semantic HTML improve accessibility, which is a Google ranking factor.',
        max_points: 2,
        category: 'mobile',
      },
    ],
  },
  {
    id: 'links',
    name_de: 'Links & Navigation',
    name_en: 'Links & Navigation',
    criteria: [
      {
        id: 'internal_links',
        name_de: 'Interne Verlinkung vorhanden',
        name_en: 'Internal links present',
        description_de: 'Die Seite sollte auf andere eigene Seiten verlinken. Mindestens 2–3 interne Links pro Seite.',
        description_en: 'The page should link to other pages on the same site. At least 2–3 internal links per page.',
        max_points: 4,
        category: 'links',
      },
      {
        id: 'broken_links',
        name_de: 'Keine defekten Links erkennbar',
        name_en: 'No broken links detected',
        description_de: 'Links ohne href, leere href="#" oder javascript:void(0) als einzige Navigation werden geprüft.',
        description_en: 'Links without href, empty href="#" or javascript:void(0) as sole navigation are checked.',
        max_points: 3,
        category: 'links',
      },
      {
        id: 'anchor_text',
        name_de: 'Beschreibende Anchor-Texte',
        name_en: 'Descriptive anchor texts',
        description_de: 'Link-Texte wie "hier klicken" oder "mehr" sind schlecht. Keywords im Anchor-Text sind besser.',
        description_en: 'Link texts like "click here" or "more" are bad. Keywords in anchor text are better.',
        max_points: 3,
        category: 'links',
      },
    ],
  },
  {
    id: 'structured_data',
    name_de: 'Strukturierte Daten',
    name_en: 'Structured Data',
    criteria: [
      {
        id: 'json_ld',
        name_de: 'JSON-LD / Schema.org vorhanden',
        name_en: 'JSON-LD / Schema.org present',
        description_de: 'Strukturierte Daten (application/ld+json) ermöglichen Rich Snippets in den Suchergebnissen.',
        description_en: 'Structured data (application/ld+json) enables rich snippets in search results.',
        max_points: 5,
        category: 'structured_data',
      },
      {
        id: 'breadcrumb_schema',
        name_de: 'Breadcrumb-Markup',
        name_en: 'Breadcrumb markup',
        description_de: 'BreadcrumbList-Schema hilft Google die Seitenstruktur zu verstehen und zeigt Breadcrumbs in der SERP.',
        description_en: 'BreadcrumbList schema helps Google understand site structure and shows breadcrumbs in the SERP.',
        max_points: 2,
        category: 'structured_data',
      },
    ],
  },
];

// ============================================================
//  HILFSFUNKTIONEN
// ============================================================

export function getAllCriteria(): Criterion[] {
  return AUDIT_CATEGORIES.flatMap(cat => cat.criteria);
}

export function getTotalMaxPoints(): number {
  return getAllCriteria().reduce((sum, c) => sum + c.max_points, 0);
}

export function getCategoryMaxPoints(categoryId: string): number {
  const cat = AUDIT_CATEGORIES.find(c => c.id === categoryId);
  if (!cat) return 0;
  return cat.criteria.reduce((sum, c) => sum + c.max_points, 0);
}
