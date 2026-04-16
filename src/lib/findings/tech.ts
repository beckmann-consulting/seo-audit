import type {
  Finding, PageSEOData, CrawlStats, SSLInfo, DNSInfo,
  SafeBrowsingData, SecurityHeadersInfo, WwwConsistencyInfo,
} from '@/types';
import { id } from './utils';

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

  // Legacy CrawlStats-based redirect-chains check removed in D2 — the
  // per-page generateRedirectFindings() already covers this with richer
  // severity (critical for loops, important for chains, critical for
  // HTTPS→HTTP downgrades) and avoids the double-reporting that existed
  // when both checks were active.

  // Pages with 4xx status
  const pages4xx = crawlStats.errorPages.filter(e => e.status >= 400 && e.status < 500);
  if (pages4xx.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `${pages4xx.length} Seite(n) mit 4xx-Statuscode`,
      title_en: `${pages4xx.length} page(s) with 4xx status code`,
      description_de: `Betroffen: ${pages4xx.slice(0, 5).map(e => `${e.url} (${e.status})`).join(', ')}`,
      description_en: `Affected: ${pages4xx.slice(0, 5).map(e => `${e.url} (${e.status})`).join(', ')}`,
      recommendation_de: '404/410-Seiten korrigieren oder korrekt löschen. 401/403 prüfen: sollen die Seiten wirklich geschützt sein?',
      recommendation_en: 'Fix or properly remove 404/410 pages. Check 401/403: should these pages really be protected?',
    });
  }

  // Pages with 5xx status
  const pages5xx = crawlStats.errorPages.filter(e => e.status >= 500);
  if (pages5xx.length > 0) {
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'high', impact: 'high',
      title_de: `${pages5xx.length} Seite(n) mit 5xx-Statuscode`,
      title_en: `${pages5xx.length} page(s) with 5xx status code`,
      description_de: `Server-Fehler: ${pages5xx.slice(0, 5).map(e => `${e.url} (${e.status})`).join(', ')}`,
      description_en: `Server errors: ${pages5xx.slice(0, 5).map(e => `${e.url} (${e.status})`).join(', ')}`,
      recommendation_de: 'Server-Logs sofort prüfen. 5xx-Fehler kosten Nutzer, Ranking und Crawl-Budget gleichzeitig.',
      recommendation_en: 'Check server logs immediately. 5xx errors cost users, ranking and crawl budget simultaneously.',
    });
  }

  // HTTP/2 heuristic — homepage protocol derived from alt-svc/via headers
  if (homepage && homepage.protocol === null) {
    findings.push({
      id: id(), priority: 'recommended', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: 'Kein Hinweis auf HTTP/2 oder HTTP/3 gefunden',
      title_en: 'No HTTP/2 or HTTP/3 indicator found',
      description_de: 'Weder alt-svc- noch via-Header der Homepage deuten auf HTTP/2 oder HTTP/3 hin. HTTP/1.1 ist spürbar langsamer bei vielen kleinen Requests (keine Multiplexing). Hinweis: Diese Heuristik ist nicht definitiv — Node\'s fetch gibt das genutzte Wire-Protokoll nicht direkt zurück.',
      description_en: 'Neither the alt-svc nor the via header on the homepage hint at HTTP/2 or HTTP/3. HTTP/1.1 is noticeably slower for many small requests (no multiplexing). Note: this heuristic is not definitive — Node\'s fetch does not expose the wire protocol.',
      recommendation_de: 'Server-Konfiguration prüfen: bei nginx ab 1.9.5 "listen 443 ssl http2;", bei Cloudflare/CDN HTTP/2 in den Proxy-Einstellungen aktivieren. HTTP/3 zusätzlich über alt-svc announcen.',
      recommendation_en: 'Check server config: nginx 1.9.5+ uses "listen 443 ssl http2;", Cloudflare/CDN enables HTTP/2 in proxy settings. Advertise HTTP/3 additionally via alt-svc.',
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

  // Render-blocking scripts finding moved to generatePerformanceFindings
  // as part of D2 module reassignment — it's conceptually a performance
  // issue, not a tech/infrastructure one.

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
//  CLIENT-SIDE RENDERING DETECTION
// ============================================================
export function generateClientRenderingFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  const rendered = pages.filter(p => p.likelyClientRendered);
  if (rendered.length === 0) return findings;

  const ratio = rendered.length / pages.length;
  const homepageAffected = pages[0]?.likelyClientRendered === true;
  const signal = rendered[0].clientRenderSignal || 'empty SPA root';

  // If homepage is affected or > 50% of pages: critical. Otherwise important.
  const priority: 'critical' | 'important' = homepageAffected || ratio > 0.5 ? 'critical' : 'important';

  findings.push({
    id: id(), priority, module: 'tech', effort: 'high', impact: 'high',
    title_de: `Seite wird clientseitig gerendert: ${rendered.length} von ${pages.length} Seiten`,
    title_en: `Site appears client-side rendered: ${rendered.length} of ${pages.length} pages`,
    description_de: `Im Roh-HTML fehlt der sichtbare Inhalt — er wird erst per JavaScript im Browser nachgeladen. Signal: "${signal}". Folgen: Googlebot rendert zwar noch, aber AI-Retrieval-Bots (ChatGPT-User, Perplexity), Social-Preview-Crawler (Facebook, Twitter, LinkedIn) und ältere Suchmaschinen sehen eine leere Seite.`,
    description_en: `The raw HTML is missing visible content — it's hydrated by JavaScript in the browser. Signal: "${signal}". Consequences: Googlebot still renders, but AI retrieval bots (ChatGPT-User, Perplexity), social preview crawlers (Facebook, Twitter, LinkedIn) and older search engines see an empty page.`,
    recommendation_de: 'Server-Side Rendering (SSR) oder Static Site Generation (SSG) einführen. Für Next.js: getServerSideProps oder generateStaticParams. Für Vue: Nuxt mit SSR. Alternativ: Prerendering-Services wie Prerender.io für kritische Seiten.',
    recommendation_en: 'Introduce Server-Side Rendering (SSR) or Static Site Generation (SSG). For Next.js: getServerSideProps or generateStaticParams. For Vue: Nuxt with SSR. Alternatively: prerendering services like Prerender.io for critical pages.',
    affectedUrl: rendered[0].url,
  });

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
//  REDIRECT FINDINGS (Check 2)
// ============================================================
// The crawler records the full redirect chain per page. We flag:
// - chains longer than 1 hop (should be direct)
// - loops (URL appears twice in the chain)
// - HTTPS → HTTP downgrades
// - any redirect on the homepage itself
export function generateRedirectFindings(pages: PageSEOData[], startUrl: string): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // Normalised set of crawled pages to look up the homepage
  const startHost = (() => { try { return new URL(startUrl).hostname; } catch { return ''; } })();

  // Loops — URL appears twice within a single chain
  const loopPages = pages.filter(p => {
    if (p.redirectChain.length === 0) return false;
    const seen = new Set<string>();
    for (const hop of p.redirectChain) {
      if (seen.has(hop)) return true;
      seen.add(hop);
    }
    return p.redirectChain.includes(p.finalUrl);
  });
  if (loopPages.length > 0) {
    const sample = loopPages.slice(0, 3).map(p => p.redirectChain.concat(p.finalUrl).join(' → ')).join(' | ');
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'high', impact: 'high',
      title_de: `Redirect-Schleifen erkannt: ${loopPages.length} Seiten`,
      title_en: `Redirect loops detected: ${loopPages.length} pages`,
      description_de: `Die folgenden URLs leiten in eine Schleife weiter — der Browser bricht mit "ERR_TOO_MANY_REDIRECTS" ab und die Seite ist für Nutzer unerreichbar: ${sample}`,
      description_en: `The following URLs redirect in a loop — browsers abort with "ERR_TOO_MANY_REDIRECTS" and the page is unreachable for users: ${sample}`,
      recommendation_de: 'Redirect-Konfiguration sofort prüfen (Webserver, CMS-Plugin, CDN). Schleifen entstehen oft durch widersprüchliche Regeln (z.B. HTTPS-Redirect + WWW-Redirect + Language-Redirect).',
      recommendation_en: 'Check redirect configuration immediately (web server, CMS plugin, CDN). Loops often arise from conflicting rules (e.g. HTTPS redirect + WWW redirect + language redirect).',
      affectedUrl: loopPages[0].redirectChain[0],
    });
  }

  // Chains > 1 hop (excluding loops which already count as critical)
  const chainPages = pages.filter(p => p.redirectChain.length > 1 && !loopPages.includes(p));
  if (chainPages.length > 0) {
    const sample = chainPages.slice(0, 3).map(p => p.redirectChain.concat(p.finalUrl).join(' → ')).join(' | ');
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `Redirect-Ketten erkannt: ${chainPages.length} Seiten`,
      title_en: `Redirect chains detected: ${chainPages.length} pages`,
      description_de: `Bei diesen URLs erfolgen mehrere aufeinanderfolgende Redirects (statt eines direkten Sprungs). Google folgt nur begrenzt vielen Hops — Ranking-Signale und Linkjuice können verloren gehen. Beispiele: ${sample}`,
      description_en: `These URLs go through multiple sequential redirects (instead of a direct jump). Google only follows a limited number of hops — ranking signals and link equity can be lost. Examples: ${sample}`,
      recommendation_de: 'Redirect-Regeln konsolidieren: Ziel-URL direkt setzen statt über Zwischenstationen. Typisches Beispiel: "example.com" → "www.example.com" → "https://www.example.com/" → "https://www.example.com/de/" sollte "example.com" → "https://www.example.com/de/" werden.',
      recommendation_en: 'Consolidate redirect rules: set the target URL directly instead of going through intermediate stops. Typical example: "example.com" → "www.example.com" → "https://www.example.com/" → "https://www.example.com/de/" should become "example.com" → "https://www.example.com/de/".',
      affectedUrl: chainPages[0].redirectChain[0],
    });
  }

  // HTTPS → HTTP downgrade
  const downgradedPages = pages.filter(p => {
    if (p.redirectChain.length === 0) return false;
    // Start was HTTPS but final is HTTP
    const first = p.redirectChain[0];
    return first.startsWith('https://') && p.finalUrl.startsWith('http://');
  });
  if (downgradedPages.length > 0) {
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'medium', impact: 'high',
      title_de: `Redirect auf HTTP statt HTTPS: ${downgradedPages.length} Seiten`,
      title_en: `Redirect to HTTP instead of HTTPS: ${downgradedPages.length} pages`,
      description_de: 'Diese Seiten werden von HTTPS auf unverschlüsseltes HTTP weitergeleitet. Das öffnet Man-in-the-Middle-Angriffe, Browser markieren die Seite als unsicher und Google rankt HTTP-Ziele schlechter.',
      description_en: 'These pages redirect from HTTPS to unencrypted HTTP. This opens man-in-the-middle attacks, browsers flag the site as insecure, and Google ranks HTTP targets worse.',
      recommendation_de: 'Alle Redirects auf HTTPS-Ziele umstellen. HTTP→HTTPS-Redirect korrekt setzen (301), aber niemals den umgekehrten Weg. HSTS-Header ergänzen.',
      recommendation_en: 'Point all redirects to HTTPS targets. Set the HTTP→HTTPS redirect correctly (301), but never the reverse. Add an HSTS header.',
      affectedUrl: downgradedPages[0].redirectChain[0],
    });
  }

  // Homepage redirect chain
  const homepage = pages.find(p => {
    try {
      return new URL(p.finalUrl).hostname === startHost && (new URL(p.finalUrl).pathname === '/' || p.depth === 0);
    } catch {
      return false;
    }
  });
  if (homepage && homepage.redirectChain.length > 1) {
    findings.push({
      id: id(), priority: 'critical', module: 'tech', effort: 'medium', impact: 'high',
      title_de: 'Homepage hat Redirect-Kette',
      title_en: 'Homepage has redirect chain',
      description_de: `Die Startseite durchläuft ${homepage.redirectChain.length} Redirect-Hops bevor der finale Inhalt ausgeliefert wird. Das verlangsamt den First Paint messbar (jeder Hop kostet ~100–300ms) und schwächt die Linkjuice-Weitergabe vom Root-Domain-Link. Kette: ${homepage.redirectChain.concat(homepage.finalUrl).join(' → ')}`,
      description_en: `The start page goes through ${homepage.redirectChain.length} redirect hops before final content is served. This measurably slows down the first paint (each hop costs ~100-300ms) and weakens link equity from root-domain links. Chain: ${homepage.redirectChain.concat(homepage.finalUrl).join(' → ')}`,
      recommendation_de: 'Homepage-Redirect direkt auf das finale Ziel setzen. Typisch: nur einen einzigen 301 von root → finaler Kombination aus Scheme+Host+Path+Trailing-Slash.',
      recommendation_en: 'Point the homepage redirect directly to the final target. Typical: just a single 301 from root → final combination of scheme+host+path+trailing slash.',
      affectedUrl: homepage.redirectChain[0],
    });
  }

  return findings;
}


// Check 4 — Third-party scripts
export function generateThirdPartyScriptFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // Collect unique third-party domains across the crawl (CDN excluded from "many" heuristic)
  const domainMap = new Map<string, { category: string; isRenderBlocking: boolean; seenOn: string }>();
  for (const p of pages) {
    for (const s of p.thirdPartyScripts) {
      const existing = domainMap.get(s.domain);
      if (!existing) {
        domainMap.set(s.domain, { category: s.category, isRenderBlocking: s.isRenderBlocking, seenOn: p.url });
      } else if (s.isRenderBlocking) {
        existing.isRenderBlocking = true;
      }
    }
  }

  // Render-blocking third-party scripts
  const renderBlocking = [...domainMap.entries()].filter(([, v]) => v.isRenderBlocking && v.category !== 'cdn');
  if (renderBlocking.length > 0) {
    const list = renderBlocking.slice(0, 5).map(([d, v]) => `${d} (${v.category})`).join(', ');
    findings.push({
      id: id(), priority: 'important', module: 'tech', effort: 'low', impact: 'high',
      title_de: `${renderBlocking.length} render-blockierende Dritt-Scripts`,
      title_en: `${renderBlocking.length} render-blocking third-party scripts`,
      description_de: `Diese externen Scripts blockieren das initiale Rendering weil sie weder async noch defer gesetzt haben: ${list}. Jeder blockierende Script kostet direkt LCP und INP.`,
      description_en: `These external scripts block initial rendering because they have neither async nor defer: ${list}. Every blocking script directly costs LCP and INP.`,
      recommendation_de: 'async oder defer auf dem Script-Tag setzen. Bei GTM und Analytics: defer ist meist OK. Bei kritisch-interaktiven Scripts: async. Tracking-Code in einen Tag Manager auslagern falls möglich.',
      recommendation_en: 'Set async or defer on the script tag. For GTM and analytics: defer is usually OK. For critical interactive scripts: async. Move tracking code into a tag manager if possible.',
    });
  }

  // Too many third-party domains (excluding CDN which is fine)
  const nonCdnCount = [...domainMap.entries()].filter(([, v]) => v.category !== 'cdn').length;
  if (nonCdnCount > 5) {
    const byCategory: Record<string, number> = {};
    for (const [, v] of domainMap) {
      if (v.category !== 'cdn') byCategory[v.category] = (byCategory[v.category] || 0) + 1;
    }
    const breakdown = Object.entries(byCategory).map(([c, n]) => `${c}: ${n}`).join(', ');
    findings.push({
      id: id(), priority: 'optional', module: 'tech', effort: 'medium', impact: 'medium',
      title_de: `${nonCdnCount} externe Script-Domains (${breakdown})`,
      title_en: `${nonCdnCount} external script domains (${breakdown})`,
      description_de: 'Jede zusätzliche Script-Domain bedeutet einen DNS-Lookup, ein TLS-Handshake und ein weiteres Third-Party-Performance-Risiko. Viele Tracker erhöhen auch die DSGVO-Fläche.',
      description_en: 'Every additional script domain means a DNS lookup, a TLS handshake and another third-party performance risk. Many trackers also increase your GDPR surface.',
      recommendation_de: 'Audit: welche Trackings werden wirklich gebraucht? Nicht-essenzielle Scripts (Heatmaps während aktiver Entwicklung, alte Ad-Pixel) entfernen. Rest via Server-Side-Tracking oder Consent-Mode konsolidieren.',
      recommendation_en: 'Audit: which tracking is actually needed? Remove non-essential scripts (heatmaps during active development, stale ad pixels). Consolidate the rest via server-side tracking or consent mode.',
    });
  }

  return findings;
}

// ============================================================
//  WWW / NON-WWW CONSISTENCY FINDINGS (Block D1)
// ============================================================
export function generateWwwConsistencyFindings(info?: WwwConsistencyInfo): Finding[] {
  if (!info || info.error || info.consistent) return [];
  return [{
    id: id(), priority: 'important', module: 'tech', effort: 'medium', impact: 'medium',
    title_de: 'www- und non-www-Version zeigen nicht auf dieselbe URL',
    title_en: 'www and non-www variants do not resolve to the same URL',
    description_de: `Die Anfrage an ${info.canonicalUrl} endet bei ${info.canonicalFinalUrl}, ${info.variantUrl} bei ${info.variantFinalUrl}. Das verteilt Linkjuice auf zwei URLs und kann zu Duplicate Content führen.`,
    description_en: `Requesting ${info.canonicalUrl} ends at ${info.canonicalFinalUrl}, while ${info.variantUrl} ends at ${info.variantFinalUrl}. This splits link equity across two URLs and can cause duplicate content.`,
    recommendation_de: 'Eine der beiden Varianten (www oder non-www) als Kanonische wählen und die andere per 301 darauf weiterleiten. In Google Search Console die bevorzugte Variante eintragen.',
    recommendation_en: 'Choose one variant (www or non-www) as canonical and 301-redirect the other to it. Set the preferred variant in Google Search Console.',
  }];
}

