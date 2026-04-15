import type {
  Finding, PageSEOData, CrawlStats, SSLInfo, DNSInfo,
  PageSpeedData, SafeBrowsingData, SecurityHeadersInfo, Module
} from '@/types';

let findingCounter = 0;
function id() { return `f${++findingCounter}`; }

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

  return findings;
}

// ============================================================
//  CONTENT FINDINGS
// ============================================================
export function generateContentFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];

  // H1 issues
  const pagesWithoutH1 = pages.filter(p => p.h1s.length === 0);
  if (pagesWithoutH1.length > 0) {
    findings.push({
      id: id(), priority: 'critical', module: 'content', effort: 'low', impact: 'high',
      title_de: `${pagesWithoutH1.length} Seite(n) ohne H1-Tag`,
      title_en: `${pagesWithoutH1.length} page(s) without H1 tag`,
      description_de: `Betroffen: ${pagesWithoutH1.slice(0, 3).map(p => p.url).join(', ')}`,
      description_en: `Affected: ${pagesWithoutH1.slice(0, 3).map(p => p.url).join(', ')}`,
      recommendation_de: 'Jede Seite braucht genau einen H1-Tag mit dem primären Keyword der Seite.',
      recommendation_en: 'Every page needs exactly one H1 tag with the page\'s primary keyword.',
    });
  }

  const pagesWithMultipleH1 = pages.filter(p => p.h1s.length > 1);
  if (pagesWithMultipleH1.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'content', effort: 'low', impact: 'medium',
      title_de: `${pagesWithMultipleH1.length} Seite(n) mit mehreren H1-Tags`,
      title_en: `${pagesWithMultipleH1.length} page(s) with multiple H1 tags`,
      description_de: pagesWithMultipleH1.slice(0, 2).map(p => `${p.url}: ${p.h1s.length} H1s (${p.h1s.slice(0,2).join(', ')})`).join('\n'),
      description_en: pagesWithMultipleH1.slice(0, 2).map(p => `${p.url}: ${p.h1s.length} H1s (${p.h1s.slice(0,2).join(', ')})`).join('\n'),
      recommendation_de: 'Pro Seite genau einen H1 verwenden. Weitere Überschriften als H2 formatieren.',
      recommendation_en: 'Use exactly one H1 per page. Format additional headings as H2.',
    });
  }

  // Images missing alt
  const totalMissingAlt = pages.reduce((s, p) => s + p.imagesMissingAlt, 0);
  const totalImages = pages.reduce((s, p) => s + p.totalImages, 0);
  if (totalMissingAlt > 0 && totalImages > 0) {
    const priority = totalMissingAlt / totalImages > 0.5 ? 'important' : 'recommended';
    findings.push({
      id: id(), priority, module: 'content', effort: 'medium', impact: 'medium',
      title_de: `${totalMissingAlt} Bild(er) ohne Alt-Text (von ${totalImages} gesamt)`,
      title_en: `${totalMissingAlt} image(s) missing alt text (of ${totalImages} total)`,
      description_de: 'Bilder ohne Alt-Text sind nicht zugänglich für Screenreader und werden von Google nicht für die Bildsuche erfasst.',
      description_en: 'Images without alt text are not accessible to screen readers and are not indexed by Google for image search.',
      recommendation_de: 'Beschreibende Alt-Texte für alle inhaltlichen Bilder ergänzen. Dekorative Bilder: alt="".',
      recommendation_en: 'Add descriptive alt texts for all content images. Decorative images: alt="".',
    });
  }

  // Thin content
  const thinPages = pages.filter(p => p.wordCount < 300 && p.wordCount > 0);
  if (thinPages.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'content', effort: 'high', impact: 'high',
      title_de: `${thinPages.length} Seite(n) mit wenig Text-Content (<300 Wörter)`,
      title_en: `${thinPages.length} page(s) with thin content (<300 words)`,
      description_de: `Betroffen: ${thinPages.slice(0, 3).map(p => `${p.url} (${p.wordCount} Wörter)`).join(', ')}`,
      description_en: `Affected: ${thinPages.slice(0, 3).map(p => `${p.url} (${p.wordCount} words)`).join(', ')}`,
      recommendation_de: 'Content ausbauen. Thin Content (< 300 Wörter) wird von Google als minderwertig eingestuft.',
      recommendation_en: 'Expand content. Thin content (< 300 words) is considered low-quality by Google.',
    });
  }

  return findings;
}

// ============================================================
//  TECH FINDINGS
// ============================================================
export function generateTechFindings(
  pages: PageSEOData[],
  crawlStats: CrawlStats,
  sslInfo?: SSLInfo,
  dnsInfo?: DNSInfo
): Finding[] {
  const findings: Finding[] = [];
  const homepage = pages[0];

  // SSL
  if (sslInfo && !sslInfo.valid) {
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'medium', impact: 'high',
      title_de: 'SSL-Zertifikat ungültig oder fehlt',
      title_en: 'SSL certificate invalid or missing',
      description_de: `SSL-Grade: ${sslInfo.grade || 'unbekannt'}. ${sslInfo.error || ''}`,
      description_en: `SSL Grade: ${sslInfo.grade || 'unknown'}. ${sslInfo.error || ''}`,
      recommendation_de: 'Gültiges SSL-Zertifikat installieren. Let\'s Encrypt ist kostenlos.',
      recommendation_en: 'Install a valid SSL certificate. Let\'s Encrypt is free.',
    });
  } else if (sslInfo?.daysUntilExpiry && sslInfo.daysUntilExpiry < 30) {
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'low', impact: 'high',
      title_de: `SSL-Zertifikat läuft in ${sslInfo.daysUntilExpiry} Tagen ab`,
      title_en: `SSL certificate expires in ${sslInfo.daysUntilExpiry} days`,
      description_de: `Ablaufdatum: ${sslInfo.expiresAt}. Nach Ablauf zeigen Browser eine Sicherheitswarnung.`,
      description_en: `Expiry: ${sslInfo.expiresAt}. After expiry, browsers show a security warning.`,
      recommendation_de: 'Zertifikat sofort erneuern. Bei Let\'s Encrypt: auto-renewal einrichten.',
      recommendation_en: 'Renew certificate immediately. For Let\'s Encrypt: set up auto-renewal.',
    });
  }

  // Broken links
  if (crawlStats.brokenLinks.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `${crawlStats.brokenLinks.length} defekte Links gefunden`,
      title_en: `${crawlStats.brokenLinks.length} broken links found`,
      description_de: `Defekte URLs: ${crawlStats.brokenLinks.slice(0, 5).join(', ')}`,
      description_en: `Broken URLs: ${crawlStats.brokenLinks.slice(0, 5).join(', ')}`,
      recommendation_de: 'Alle defekten Links korrigieren oder entfernen. 404-Fehler schaden dem Crawl-Budget.',
      recommendation_en: 'Fix or remove all broken links. 404 errors harm the crawl budget.',
    });
  }

  // Redirect chains
  if (crawlStats.redirectChains.length > 2) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `${crawlStats.redirectChains.length} Redirect-Ketten gefunden`,
      title_en: `${crawlStats.redirectChains.length} redirect chains found`,
      description_de: crawlStats.redirectChains.slice(0, 3).map(r => `${r.from} → ${r.to}`).join('\n'),
      description_en: crawlStats.redirectChains.slice(0, 3).map(r => `${r.from} → ${r.to}`).join('\n'),
      recommendation_de: 'Direkte 301-Weiterleitungen zum finalen Ziel einrichten. Ketten verlangsamen den Crawler.',
      recommendation_en: 'Set up direct 301 redirects to the final destination. Chains slow down the crawler.',
    });
  }

  // DNS: SPF
  if (dnsInfo && !dnsInfo.hasSPF) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'low', impact: 'medium',
      title_de: 'Kein SPF-Record (E-Mail-Authentifizierung)',
      title_en: 'No SPF record (email authentication)',
      description_de: 'Ohne SPF-Record können E-Mails von dieser Domain leicht gefälscht werden (Spoofing).',
      description_en: 'Without an SPF record, emails from this domain can easily be spoofed.',
      recommendation_de: 'TXT-Record hinzufügen: v=spf1 include:[mailprovider] ~all',
      recommendation_en: 'Add TXT record: v=spf1 include:[mailprovider] ~all',
    });
  }

  // DNS: DMARC
  if (dnsInfo && !dnsInfo.hasDMARC) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'low', impact: 'medium',
      title_de: 'Kein DMARC-Record',
      title_en: 'No DMARC record',
      description_de: 'Ohne DMARC können keine Richtlinien für fehlgeschlagene E-Mail-Authentifizierung definiert werden.',
      description_en: 'Without DMARC, no policies for failed email authentication can be defined.',
      recommendation_de: '_dmarc TXT-Record hinzufügen: v=DMARC1; p=none; rua=mailto:dmarc@domain.com',
      recommendation_en: 'Add _dmarc TXT record: v=DMARC1; p=none; rua=mailto:dmarc@domain.com',
    });
  }

  // Render-blocking scripts
  const totalRenderBlocking = pages.reduce((s, p) => s + p.renderBlockingScripts, 0);
  if (totalRenderBlocking > 3) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `${totalRenderBlocking} render-blockierende Scripts gefunden`,
      title_en: `${totalRenderBlocking} render-blocking scripts found`,
      description_de: 'Scripts im <head> ohne async/defer blockieren das Rendern und verlangsamen die wahrgenommene Ladezeit.',
      description_en: 'Scripts in the <head> without async/defer block rendering and slow down perceived load time.',
      recommendation_de: 'Externe Scripts mit defer oder async laden: <script src="..." defer>',
      recommendation_en: 'Load external scripts with defer or async: <script src="..." defer>',
    });
  }

  // Modern image formats
  const totalImages = pages.reduce((s, p) => s + p.totalImages, 0);
  const modernImages = pages.reduce((s, p) => s + p.modernImageFormats, 0);
  if (totalImages > 5 && modernImages / totalImages < 0.5) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `Nur ${modernImages} von ${totalImages} Bildern in modernen Formaten (WebP/AVIF)`,
      title_en: `Only ${modernImages} of ${totalImages} images in modern formats (WebP/AVIF)`,
      description_de: 'JPEG/PNG-Bilder sind 25–50% größer als WebP/AVIF bei gleicher Qualität.',
      description_en: 'JPEG/PNG images are 25–50% larger than WebP/AVIF at the same quality.',
      recommendation_de: 'Alle Bilder in WebP konvertieren. Squoosh.app oder cwebp für Batch-Konvertierung.',
      recommendation_en: 'Convert all images to WebP. Use Squoosh.app or cwebp for batch conversion.',
    });
  }

  return findings;
}

// ============================================================
//  LEGAL FINDINGS
// ============================================================
export function generateLegalFindings(pages: PageSEOData[], allHtml: string): Finding[] {
  const findings: Finding[] = [];
  const allText = allHtml.toLowerCase();

  // Impressum check
  const hasImpressum = pages.some(p =>
    p.url.includes('/impressum') ||
    p.url.includes('/imprint') ||
    p.url.includes('/legal-notice') ||
    p.url.includes('/legal')
  );
  if (!hasImpressum) {
    findings.push({
      id: id(), priority: 'critical', module: 'legal', effort: 'low', impact: 'high',
      title_de: 'Kein Impressum gefunden',
      title_en: 'No legal notice (Impressum) found',
      description_de: 'Für Unternehmen mit EU-Bezug ist ein Impressum gemäß §5 TMG bzw. §25 MedienStV Pflicht. Fehlt es, drohen Abmahnungen.',
      description_en: 'For companies with EU connections, a legal notice is mandatory under §5 TMG / §25 MedienStV. Absence risks legal warnings.',
      recommendation_de: 'Impressum-Seite erstellen mit: vollständiger Firmenname, Adresse, Geschäftsführer, Handelsregisternummer, USt-IdNr., E-Mail.',
      recommendation_en: 'Create legal notice page with: full company name, address, managing director, company registration, VAT number, email.',
    });
  }

  // Privacy policy check
  const hasPrivacy = pages.some(p =>
    p.url.includes('/privacy') ||
    p.url.includes('/datenschutz') ||
    p.url.includes('/data-protection') ||
    p.url.includes('/gdpr')
  );
  if (!hasPrivacy) {
    findings.push({
      id: id(), priority: 'critical', module: 'legal', effort: 'medium', impact: 'high',
      title_de: 'Keine Datenschutzerklärung gefunden',
      title_en: 'No privacy policy found',
      description_de: 'Eine Datenschutzerklärung ist nach DSGVO (Art. 13/14) für alle Websites Pflicht, die Daten verarbeiten.',
      description_en: 'A privacy policy is mandatory under GDPR (Art. 13/14) for all websites that process data.',
      recommendation_de: 'Datenschutzerklärung erstellen die alle Datenverarbeitungen (Analytics, Kontaktformular, Cookies etc.) beschreibt.',
      recommendation_en: 'Create a privacy policy describing all data processing activities (analytics, contact forms, cookies, etc.).',
    });
  }

  // Cookie consent banner — check for common CMP scripts
  const hasCMPScript = allText.includes('cookiebot') ||
    allText.includes('cookieyes') ||
    allText.includes('usercentrics') ||
    allText.includes('onetrust') ||
    allText.includes('trustarcade') ||
    allText.includes('consentmanager') ||
    allText.includes('axeptio') ||
    allText.includes('cookie-consent') ||
    allText.includes('gdpr-cookie');

  if (!hasCMPScript) {
    findings.push({
      id: id(), priority: 'important', module: 'legal', effort: 'medium', impact: 'high',
      title_de: 'Kein aktives Cookie-Consent-Banner erkennbar',
      title_en: 'No active cookie consent banner detected',
      description_de: 'Kein bekanntes Consent-Management-System (Cookiebot, CookieYes, Usercentrics etc.) im Quellcode gefunden. Bei Nutzung von Analytics/Tracking ist ein Consent-Banner nach DSGVO Pflicht.',
      description_en: 'No known consent management system (Cookiebot, CookieYes, Usercentrics etc.) found in source. If using analytics/tracking, a consent banner is mandatory under GDPR.',
      recommendation_de: 'Cookiebot oder CookieYes integrieren (beide haben kostenlose Tiers). Einwilligung vor dem Setzen nicht-essentieller Cookies einholen.',
      recommendation_en: 'Integrate Cookiebot or CookieYes (both have free tiers). Obtain consent before setting non-essential cookies.',
    });
  }

  return findings;
}

// ============================================================
//  UX FINDINGS
// ============================================================
export function generateUXFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  const homepage = pages[0];
  if (!homepage) return findings;

  // Viewport
  if (!homepage.hasViewport) {
    findings.push({
      id: id(), priority: 'critical', module: 'ux', effort: 'low', impact: 'high',
      title_de: 'Kein Viewport Meta-Tag',
      title_en: 'No viewport meta tag',
      description_de: 'Ohne Viewport-Tag ist die Seite auf mobilen Geräten nicht korrekt dargestellt.',
      description_en: 'Without a viewport tag, the page is not correctly displayed on mobile devices.',
      recommendation_de: '<meta name="viewport" content="width=device-width, initial-scale=1"> in den <head> einfügen.',
      recommendation_en: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.',
    });
  }

  // Social links check
  const hasSocialLinks = pages.some(p =>
    p.externalLinks.some(l =>
      l.includes('linkedin.com') ||
      l.includes('twitter.com') ||
      l.includes('x.com') ||
      l.includes('instagram.com') ||
      l.includes('facebook.com')
    )
  );
  if (!hasSocialLinks) {
    findings.push({
      id: id(), priority: 'optional', module: 'ux', effort: 'low', impact: 'low',
      title_de: 'Keine Social-Media-Links gefunden',
      title_en: 'No social media links found',
      description_de: 'Social-Media-Profile fehlen als Vertrauenssignal im Footer oder Header.',
      description_en: 'Social media profiles are missing as trust signals in the footer or header.',
      recommendation_de: 'LinkedIn, X/Twitter und weitere relevante Profile im Footer verlinken.',
      recommendation_en: 'Link LinkedIn, X/Twitter and other relevant profiles in the footer.',
    });
  }

  // Internal linking
  const pagesWithFewLinks = pages.filter(p => p.internalLinks.length < 3);
  if (pagesWithFewLinks.length > pages.length * 0.5) {
    findings.push({
      id: id(), priority: 'recommended', module: 'ux', effort: 'medium', impact: 'medium',
      title_de: 'Schwache interne Verlinkung auf vielen Seiten',
      title_en: 'Weak internal linking on many pages',
      description_de: `${pagesWithFewLinks.length} von ${pages.length} Seiten haben weniger als 3 interne Links.`,
      description_en: `${pagesWithFewLinks.length} of ${pages.length} pages have fewer than 3 internal links.`,
      recommendation_de: 'Interne Verlinkung ausbauen. Verwandte Seiten und CTAs auf jeder Seite verlinken.',
      recommendation_en: 'Build up internal linking. Link related pages and CTAs on every page.',
    });
  }

  return findings;
}

// ============================================================
//  PERFORMANCE FINDINGS
// ============================================================
export function generatePerformanceFindings(pageSpeed?: PageSpeedData): Finding[] {
  const findings: Finding[] = [];
  if (!pageSpeed || pageSpeed.error) return findings;

  if (pageSpeed.performanceScore !== undefined && pageSpeed.performanceScore < 50) {
    findings.push({
      id: id(), priority: 'critical', module: 'performance', effort: 'high', impact: 'high',
      title_de: `PageSpeed Score kritisch: ${pageSpeed.performanceScore}/100`,
      title_en: `PageSpeed score critical: ${pageSpeed.performanceScore}/100`,
      description_de: `Google Lighthouse Performance-Score: ${pageSpeed.performanceScore}/100. LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'}, CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'}, TBT: ${pageSpeed.tbt ? Math.round(pageSpeed.tbt) + 'ms' : 'n/a'}`,
      description_en: `Google Lighthouse Performance Score: ${pageSpeed.performanceScore}/100. LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'}, CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'}, TBT: ${pageSpeed.tbt ? Math.round(pageSpeed.tbt) + 'ms' : 'n/a'}`,
      recommendation_de: 'Bilder optimieren, Render-blocking Scripts entfernen, Server-Response-Zeit verbessern.',
      recommendation_en: 'Optimise images, remove render-blocking scripts, improve server response time.',
    });
  } else if (pageSpeed.performanceScore !== undefined && pageSpeed.performanceScore < 75) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `PageSpeed Score verbesserungswürdig: ${pageSpeed.performanceScore}/100`,
      title_en: `PageSpeed score needs improvement: ${pageSpeed.performanceScore}/100`,
      description_de: `LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'} (Ziel: <2.5s), CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'} (Ziel: <0.1)`,
      description_en: `LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'} (target: <2.5s), CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'} (target: <0.1)`,
      recommendation_de: 'Core Web Vitals optimieren: LCP unter 2.5s, CLS unter 0.1, INP unter 200ms (FID unter 100ms als Legacy-Metrik).',
      recommendation_en: 'Optimise Core Web Vitals: LCP under 2.5s, CLS under 0.1, INP under 200ms (FID under 100ms as legacy metric).',
    });
  }

  // INP (Interaction to Next Paint) — replaced FID as Core Web Vital in March 2024
  if (pageSpeed.inp && pageSpeed.inp > 500) {
    findings.push({
      id: id(), priority: 'critical', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `INP kritisch: ${Math.round(pageSpeed.inp)}ms`,
      title_en: `INP critical: ${Math.round(pageSpeed.inp)}ms`,
      description_de: 'Interaction to Next Paint > 500ms wird von Google als "schlecht" eingestuft. INP misst die Reaktionsfähigkeit bei Nutzerinteraktionen und hat FID seit März 2024 als Core Web Vital ersetzt.',
      description_en: 'Interaction to Next Paint > 500ms is rated "poor" by Google. INP measures responsiveness to user interactions and replaced FID as a Core Web Vital in March 2024.',
      recommendation_de: 'JavaScript-Ausführung reduzieren, lange Tasks aufteilen, Event-Handler optimieren, nicht-kritische Scripts verzögern.',
      recommendation_en: 'Reduce JavaScript execution, break up long tasks, optimise event handlers, defer non-critical scripts.',
    });
  } else if (pageSpeed.inp && pageSpeed.inp > 200) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `INP verbesserungswürdig: ${Math.round(pageSpeed.inp)}ms`,
      title_en: `INP needs improvement: ${Math.round(pageSpeed.inp)}ms`,
      description_de: 'Interaction to Next Paint zwischen 200ms und 500ms gilt als verbesserungswürdig. Ziel: unter 200ms für eine flüssige Nutzerinteraktion.',
      description_en: 'Interaction to Next Paint between 200ms and 500ms is considered needing improvement. Target: under 200ms for smooth user interaction.',
      recommendation_de: 'Lange JavaScript-Tasks identifizieren (Performance-Panel im Browser), Event-Handler verschlanken, requestIdleCallback für Nicht-Prioritäres nutzen.',
      recommendation_en: 'Identify long JavaScript tasks (browser Performance panel), slim down event handlers, use requestIdleCallback for non-priority work.',
    });
  }

  // FID (Legacy — kept alongside INP for completeness)
  if (pageSpeed.fidField && pageSpeed.fidField > 300) {
    findings.push({
      id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `FID (Feld-Daten) hoch: ${Math.round(pageSpeed.fidField)}ms`,
      title_en: `FID (field data) high: ${Math.round(pageSpeed.fidField)}ms`,
      description_de: 'First Input Delay aus echten Nutzerdaten (CrUX) > 300ms. FID ist zwar durch INP als Core Web Vital abgelöst, bleibt aber ein Indikator für schlechte Interaktivität beim ersten Klick.',
      description_en: 'First Input Delay from real-user data (CrUX) > 300ms. FID has been replaced by INP as a Core Web Vital but remains an indicator of poor first-click responsiveness.',
      recommendation_de: 'Main-Thread-Blockaden reduzieren, kritisches JavaScript aufteilen.',
      recommendation_en: 'Reduce main-thread blocking, split up critical JavaScript.',
    });
  }

  if (pageSpeed.lcp && pageSpeed.lcp > 4000) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `Largest Contentful Paint zu langsam: ${Math.round(pageSpeed.lcp / 100) / 10}s`,
      title_en: `Largest Contentful Paint too slow: ${Math.round(pageSpeed.lcp / 100) / 10}s`,
      description_de: 'LCP > 4s ist ein kritisches Core Web Vital. Google stuft dies als "schlecht" ein.',
      description_en: 'LCP > 4s is a critical Core Web Vital. Google rates this as "poor".',
      recommendation_de: 'Hero-Bild preloaden, Server-Response-Zeit optimieren, nicht-kritische Scripts verzögern.',
      recommendation_en: 'Preload hero image, optimise server response time, defer non-critical scripts.',
    });
  }

  return findings;
}

// ============================================================
//  SAFE BROWSING FINDINGS
// ============================================================
export function generateSafeBrowsingFindings(data?: SafeBrowsingData): Finding[] {
  if (!data || data.isSafe) return [];
  return [{
    id: id(), priority: 'critical', module: 'tech', effort: 'high', impact: 'high',
    title_de: `Google Safe Browsing: Bedrohung erkannt (${data.threats?.join(', ')})`,
    title_en: `Google Safe Browsing: Threat detected (${data.threats?.join(', ')})`,
    description_de: 'Google hat diese Domain als unsicher markiert. Browser zeigen Warnmeldungen — der organische Traffic bricht sofort ein.',
    description_en: 'Google has flagged this domain as unsafe. Browsers show warnings — organic traffic drops immediately.',
    recommendation_de: 'Google Search Console aufrufen und den Bericht zu Sicherheitsproblemen prüfen. Malware entfernen und Überprüfung beantragen.',
    recommendation_en: 'Open Google Search Console and check the Security Issues report. Remove malware and request a review.',
  }];
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
//  SECURITY HEADERS FINDINGS
// ============================================================
export function generateSecurityHeadersFindings(sh?: SecurityHeadersInfo): Finding[] {
  const findings: Finding[] = [];
  if (!sh || sh.error) return findings;

  // HSTS
  if (!sh.hsts) {
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'low', impact: 'medium',
      title_de: 'HTTP Strict Transport Security (HSTS) fehlt',
      title_en: 'HTTP Strict Transport Security (HSTS) missing',
      description_de: 'Der Header "Strict-Transport-Security" fehlt. Ohne HSTS können Man-in-the-Middle-Angriffe den ersten Request downgraden (HTTPS → HTTP).',
      description_en: 'The "Strict-Transport-Security" header is missing. Without HSTS, man-in-the-middle attackers can downgrade the first request (HTTPS → HTTP).',
      recommendation_de: 'Header setzen: "Strict-Transport-Security: max-age=31536000; includeSubDomains". Vorher sicherstellen, dass alle Subdomains HTTPS unterstützen.',
      recommendation_en: 'Set header: "Strict-Transport-Security: max-age=31536000; includeSubDomains". Ensure all subdomains support HTTPS first.',
    });
  } else if (sh.hstsMaxAge !== undefined && sh.hstsMaxAge < 15552000) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'low', impact: 'low',
      title_de: `HSTS max-age zu kurz: ${sh.hstsMaxAge}s`,
      title_en: `HSTS max-age too short: ${sh.hstsMaxAge}s`,
      description_de: `max-age = ${sh.hstsMaxAge}s (< 6 Monate). Empfohlen sind mindestens 1 Jahr (31536000s) für wirksamen Schutz.`,
      description_en: `max-age = ${sh.hstsMaxAge}s (< 6 months). At least 1 year (31536000s) is recommended for effective protection.`,
      recommendation_de: 'max-age auf 31536000 (1 Jahr) erhöhen, sobald HTTPS zuverlässig läuft.',
      recommendation_en: 'Increase max-age to 31536000 (1 year) once HTTPS is reliable.',
    });
  }

  // X-Content-Type-Options
  if (!sh.xContentTypeOptions) {
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'low', impact: 'medium',
      title_de: 'X-Content-Type-Options fehlt',
      title_en: 'X-Content-Type-Options missing',
      description_de: 'Ohne "X-Content-Type-Options: nosniff" kann der Browser MIME-Types erraten. Das öffnet XSS- und Script-Injection-Vektoren bei falsch konfigurierten Uploads.',
      description_en: 'Without "X-Content-Type-Options: nosniff" the browser may guess MIME types. This opens XSS and script-injection vectors on misconfigured uploads.',
      recommendation_de: 'Header setzen: "X-Content-Type-Options: nosniff".',
      recommendation_en: 'Set header: "X-Content-Type-Options: nosniff".',
    });
  } else if (sh.xContentTypeOptions.toLowerCase() !== 'nosniff') {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'low', impact: 'low',
      title_de: `X-Content-Type-Options hat unerwarteten Wert: "${sh.xContentTypeOptions}"`,
      title_en: `X-Content-Type-Options has unexpected value: "${sh.xContentTypeOptions}"`,
      description_de: 'Der einzige gültige Wert ist "nosniff".',
      description_en: 'The only valid value is "nosniff".',
      recommendation_de: 'Wert auf "nosniff" setzen.',
      recommendation_en: 'Set value to "nosniff".',
    });
  }

  // X-Frame-Options or CSP frame-ancestors
  const hasFrameProtection = !!sh.xFrameOptions || /frame-ancestors/i.test(sh.csp || '');
  if (!hasFrameProtection) {
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'low', impact: 'medium',
      title_de: 'Clickjacking-Schutz fehlt (X-Frame-Options / CSP frame-ancestors)',
      title_en: 'Clickjacking protection missing (X-Frame-Options / CSP frame-ancestors)',
      description_de: 'Ohne X-Frame-Options oder CSP "frame-ancestors" kann die Seite in fremden iframes eingebettet werden — Grundlage für Clickjacking-Angriffe.',
      description_en: 'Without X-Frame-Options or CSP "frame-ancestors" the site can be embedded in foreign iframes — the basis for clickjacking attacks.',
      recommendation_de: 'Header setzen: "X-Frame-Options: SAMEORIGIN" oder im CSP "frame-ancestors \'self\'".',
      recommendation_en: 'Set header: "X-Frame-Options: SAMEORIGIN" or in CSP "frame-ancestors \'self\'".',
    });
  }

  // Content-Security-Policy
  if (!sh.csp) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'high', impact: 'medium',
      title_de: 'Content-Security-Policy (CSP) fehlt',
      title_en: 'Content-Security-Policy (CSP) missing',
      description_de: 'Kein CSP-Header. CSP ist die wirksamste Verteidigung gegen XSS: Sie definiert genau, welche Scripts, Styles und Ressourcen geladen werden dürfen.',
      description_en: 'No CSP header. CSP is the most effective defence against XSS: it defines exactly which scripts, styles and resources may load.',
      recommendation_de: 'CSP schrittweise einführen — zuerst im Report-Only-Modus ("Content-Security-Policy-Report-Only"), auswerten, dann enforcen. Als Startpunkt: "default-src \'self\'; script-src \'self\'; img-src \'self\' data: https:".',
      recommendation_en: 'Roll out CSP gradually — start in report-only mode ("Content-Security-Policy-Report-Only"), analyse reports, then enforce. Starting point: "default-src \'self\'; script-src \'self\'; img-src \'self\' data: https:".',
    });
  }

  // Referrer-Policy
  if (!sh.referrerPolicy) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'low', impact: 'low',
      title_de: 'Referrer-Policy fehlt',
      title_en: 'Referrer-Policy missing',
      description_de: 'Ohne Referrer-Policy werden möglicherweise URL-Pfade (inkl. Query-Parameter) an externe Seiten weitergegeben — Datenschutz- und Informationsleak-Risiko.',
      description_en: 'Without Referrer-Policy, URL paths (including query parameters) may leak to external sites — privacy and information-leak risk.',
      recommendation_de: 'Header setzen: "Referrer-Policy: strict-origin-when-cross-origin" (guter Default für die meisten Seiten).',
      recommendation_en: 'Set header: "Referrer-Policy: strict-origin-when-cross-origin" (good default for most sites).',
    });
  }

  // Permissions-Policy
  if (!sh.permissionsPolicy) {
    findings.push({
      id: id(), priority: 'optional', module: 'tech', effort: 'low', impact: 'low',
      title_de: 'Permissions-Policy fehlt',
      title_en: 'Permissions-Policy missing',
      description_de: 'Permissions-Policy (früher Feature-Policy) begrenzt, welche Browser-Features (Kamera, Mikrofon, Geolocation etc.) die Seite und eingebettete iframes nutzen dürfen.',
      description_en: 'Permissions-Policy (formerly Feature-Policy) restricts which browser features (camera, microphone, geolocation etc.) the page and embedded iframes may use.',
      recommendation_de: 'Header setzen, z.B.: "Permissions-Policy: camera=(), microphone=(), geolocation=()". Nur Features erlauben, die wirklich gebraucht werden.',
      recommendation_en: 'Set header, e.g.: "Permissions-Policy: camera=(), microphone=(), geolocation=()". Only allow features actually needed.',
    });
  }

  // Cookie Secure flag
  if (sh.hasCookieSecure === false) {
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'low', impact: 'medium',
      title_de: 'Cookies ohne Secure-Flag',
      title_en: 'Cookies without Secure flag',
      description_de: 'Mindestens ein gesetztes Cookie hat kein "Secure"-Attribut. Diese Cookies können über unverschlüsselte HTTP-Requests abgefangen werden.',
      description_en: 'At least one cookie is set without the "Secure" attribute. These cookies can be intercepted over unencrypted HTTP requests.',
      recommendation_de: 'Alle Cookies mit "Secure; HttpOnly; SameSite=Lax" (oder Strict) setzen.',
      recommendation_en: 'Set all cookies with "Secure; HttpOnly; SameSite=Lax" (or Strict).',
    });
  }

  // Mixed content
  if (sh.hasMixedContent) {
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'medium', impact: 'high',
      title_de: 'Mixed Content erkannt',
      title_en: 'Mixed content detected',
      description_de: 'Die HTTPS-Seite lädt Ressourcen über unverschlüsseltes HTTP. Browser blockieren diese teilweise oder zeigen Warnungen an — Vertrauens- und Funktionsverlust.',
      description_en: 'The HTTPS page loads resources over unencrypted HTTP. Browsers partially block these or show warnings — loss of trust and functionality.',
      recommendation_de: 'Alle http://-Referenzen im HTML und in CSS/JS auf https:// umstellen. Protokollrelative URLs (//example.com/…) vermeiden.',
      recommendation_en: 'Switch all http:// references in HTML and in CSS/JS to https://. Avoid protocol-relative URLs (//example.com/…).',
    });
  }

  return findings;
}

// ============================================================
//  SCORING
// ============================================================
export function calculateModuleScore(findings: Finding[], module: Module, maxPossible: number = 100): number {
  const moduleFindings = findings.filter(f => f.module === module);
  let penalty = 0;
  moduleFindings.forEach(f => {
    if (f.priority === 'critical') penalty += 25;
    else if (f.priority === 'important') penalty += 12;
    else if (f.priority === 'recommended') penalty += 5;
    else penalty += 2;
  });
  return Math.max(0, Math.min(100, maxPossible - penalty));
}
