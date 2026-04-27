// Multilingual detection of legal pages (imprint, privacy, cookie,
// terms). Supersedes the crude `url.includes('/impressum')`-style
// substring match that lived in findings/legal.ts. The substring
// approach has two well-known failure modes:
//
//   1. False positives — `/blog/about-our-privacy-approach` looked
//      like a privacy page; `/products/cookie-cutter` looked like a
//      cookie policy.
//   2. False negatives — Shopify's `/policies/privacy`, Webflow's
//      `/footer/legal`, language-prefixed paths like `/de/datenschutz`,
//      and any locale variant beyond German/English were missed.
//
// The new detection:
//   - Patterns are matched against either the FULL path OR the LAST
//     path segment, so locale prefixes (/de/, /en-us/) and folder
//     prefixes (/policies/, /footer/) work without listing every
//     combination.
//   - The path is percent-decoded before comparison so umlauts in
//     the URL ("/datenschutzerklärung" served as
//     "/datenschutzerkl%C3%A4rung") still match.
//   - Imprint detection has an EMBEDDED-marker fallback: if no URL
//     matches a known pattern, we scan the site HTML for explicit
//     legal markers ("§ 5 TMG", "directeur de la publication", …).
//     This catches sites that put their imprint on a custom URL but
//     include the legally required boilerplate.

import type { PageSEOData } from '@/types';

// ============================================================
//  URL pattern lists
// ============================================================

export const IMPRINT_URL_PATTERNS = [
  // Deutsch
  '/impressum', '/impressum.html', '/impressum.php',
  '/impressum-und-kontakt', '/kontakt-impressum', '/de/impressum',
  // English (multiple conventions)
  '/imprint', '/legal-notice', '/legal-notices', '/legal', '/legals',
  '/legal-information', '/legal-info', '/legal-disclosure',
  '/disclosure', '/disclosures', '/site-notice', '/website-notice',
  '/company-information', '/company-info',
  '/about/legal', '/about/imprint', '/about/legal-notice',
  '/about-us/legal', '/company/legal', '/info/legal',
  '/footer/legal', '/utility/legal',
  // Französisch
  '/mentions-legales', '/mentions-légales', '/mention-legale',
  '/informations-legales', '/notice-legale',
  // Spanisch
  '/aviso-legal', '/avisolegal', '/informacion-legal', '/nota-legal',
  // Italienisch
  '/note-legali', '/avvertenze-legali', '/informazioni-legali',
  // Niederländisch
  '/colofon', '/juridische-kennisgeving', '/juridisch',
  '/wettelijke-vermelding',
  // Portugiesisch
  '/aviso-legal-pt', '/informacao-legal', '/nota-legal-pt',
  // Polnisch
  '/nota-prawna', '/informacje-prawne',
  // Skandinavisch
  '/juridisk-information', '/juridisk-meddelelse',
  '/juridiset-tiedot', '/oikeudellinen-huomautus',
  // Tschechisch / Slowakisch
  '/pravni-upozorneni', '/pravne-upozornenie',
];

export const PRIVACY_URL_PATTERNS = [
  // English (largest variation surface)
  '/privacy', '/privacy-policy', '/privacy-policies', '/privacypolicy',
  '/privacy_policy', '/privacy-notice', '/privacy-statement',
  '/privacystatement', '/data-privacy', '/data-protection',
  '/data-protection-policy', '/dataprivacy', '/dataprotection',
  '/personal-data', '/personal-information',
  '/gdpr', '/gdpr-policy', '/ccpa', '/ccpa-notice',
  '/your-privacy-rights', '/privacy-rights', '/privacy-choices',
  '/about/privacy', '/legal/privacy',
  '/policies/privacy', '/policies/privacy-policy',
  '/footer/privacy', '/utility/privacy',
  // Deutsch
  '/datenschutz', '/datenschutz.html', '/datenschutz.php',
  '/datenschutzerklaerung', '/datenschutzerklärung',
  '/datenschutz-erklaerung', '/datenschutz-erklärung',
  '/datenschutzhinweis', '/datenschutzhinweise',
  '/datenschutzinformationen', '/datenschutzbestimmungen',
  '/datenschutzrichtlinie', '/datenschutzrichtlinien',
  '/dsgvo', '/dsgvo-info', '/de/datenschutz',
  // Französisch
  '/politique-de-confidentialite', '/politique-de-confidentialité',
  '/politique-confidentialite', '/confidentialite', '/confidentialité',
  '/protection-des-donnees', '/protection-données-personnelles',
  '/donnees-personnelles', '/rgpd',
  // Spanisch
  '/politica-de-privacidad', '/política-de-privacidad',
  '/politica-privacidad', '/privacidad',
  '/proteccion-de-datos', '/protección-de-datos', '/aviso-de-privacidad',
  // Italienisch
  '/informativa-privacy', '/informativa-sulla-privacy',
  '/privacy-policy-it', '/privacy-italiano',
  '/protezione-dati', '/normativa-privacy',
  // Niederländisch
  '/privacybeleid', '/privacyverklaring', '/privacy-verklaring',
  '/gegevensbescherming', '/avg',
  // Portugiesisch
  '/politica-de-privacidade', '/política-de-privacidade',
  '/privacidade', '/protecao-de-dados', '/proteção-de-dados',
  // Polnisch
  '/polityka-prywatnosci', '/polityka-prywatności',
  '/ochrona-danych', '/rodo',
  // Skandinavisch
  '/integritetspolicy', '/personuppgiftspolicy',
  '/persondatapolitik', '/privatlivspolitik',
  '/personvern', '/personvernerklaering',
  '/tietosuoja', '/tietosuojakaytanto',
  // Tschechisch / Slowakisch
  '/ochrana-osobnich-udaju', '/ochrana-udajov',
  '/zasady-ochrany-osobnich-udaju',
  // Russisch (transliteriert)
  '/politika-konfidencialnosti', '/konfidencialnost',
];

export const COOKIE_URL_PATTERNS = [
  // English
  '/cookies', '/cookie',
  '/cookie-policy', '/cookies-policy', '/cookiepolicy', '/cookie_policy',
  '/cookie-notice', '/cookie-statement', '/cookie-information',
  '/cookie-settings', '/cookie-preferences', '/cookie-consent',
  '/policies/cookies', '/footer/cookies',
  // Deutsch
  '/cookie-richtlinie', '/cookie-richtlinien', '/cookie-hinweise',
  '/cookie-erklaerung', '/cookie-erklärung', '/cookies-de',
  // Französisch
  '/politique-cookies', '/politique-de-cookies',
  '/politique-des-cookies', '/gestion-des-cookies',
  // Spanisch
  '/politica-de-cookies', '/política-de-cookies', '/politica-cookies',
  // Italienisch
  '/informativa-cookie', '/cookie-policy-it',
  // Niederländisch
  '/cookiebeleid', '/cookieverklaring',
  // Portugiesisch
  '/politica-de-cookies-pt', '/politica-cookies-pt',
];

export const TERMS_URL_PATTERNS = [
  // English
  '/terms', '/terms-of-use', '/terms-of-service',
  '/terms-and-conditions', '/terms-conditions',
  '/termsofservice', '/termsofuse', '/tos', '/tac',
  '/conditions', '/conditions-of-use', '/user-agreement', '/eula',
  '/policies/terms-of-service',
  // Deutsch
  '/agb', '/agb.html',
  '/allgemeine-geschaeftsbedingungen', '/allgemeine-geschäftsbedingungen',
  '/nutzungsbedingungen', '/nutzungsvereinbarung',
  '/geschaeftsbedingungen',
  // Französisch
  '/cgu', '/cgv',
  '/conditions-generales', '/conditions-utilisation',
  '/conditions-vente',
  // Spanisch
  '/terminos', '/términos',
  '/terminos-y-condiciones', '/términos-y-condiciones',
  '/condiciones-de-uso', '/condiciones-generales',
  // Italienisch
  '/termini', '/termini-e-condizioni', '/termini-di-servizio',
  '/condizioni-utilizzo', '/condizioni-generali',
  // Niederländisch
  '/algemene-voorwaarden', '/gebruiksvoorwaarden', '/voorwaarden',
  // Portugiesisch
  '/termos', '/termos-de-uso', '/termos-e-condicoes',
  '/condicoes-de-uso',
];

// ============================================================
//  Anchor-text lists (exported for future use; not yet wired)
// ============================================================

export const IMPRINT_ANCHOR_TEXTS = [
  'impressum', 'imprint',
  'legal notice', 'legal notices', 'legal',
  'site notice', 'company info', 'company information',
  'mentions légales', 'mentions legales',
  'aviso legal', 'avviso legale',
  'note legali', 'informazioni legali',
  'colofon', 'juridische kennisgeving',
  'nota prawna',
];

export const PRIVACY_ANCHOR_TEXTS = [
  'privacy', 'privacy policy', 'privacy notice', 'privacy statement',
  'data privacy', 'data protection',
  'gdpr', 'ccpa', 'your privacy', 'privacy rights',
  'datenschutz', 'datenschutzerklärung', 'datenschutzhinweise',
  'datenschutzbestimmungen', 'dsgvo',
  'politique de confidentialité', 'politique confidentialité',
  'confidentialité', 'rgpd', 'protection des données',
  'política de privacidad', 'politica de privacidad',
  'privacidad', 'protección de datos',
  'informativa privacy', 'informativa sulla privacy',
  'protezione dati',
  'privacybeleid', 'privacyverklaring',
  'política de privacidade', 'privacidade',
  'polityka prywatności',
  'integritetspolicy', 'persondatapolitik', 'personvern',
  'tietosuoja',
];

export const COOKIE_ANCHOR_TEXTS = [
  'cookie', 'cookies',
  'cookie policy', 'cookies policy', 'cookie notice',
  'cookie settings', 'cookie preferences', 'cookie consent',
  'cookie-richtlinie', 'cookie-hinweise',
  'politique cookies', 'politique de cookies',
  'política de cookies',
  'informativa cookie',
  'cookiebeleid', 'cookieverklaring',
];

export const TERMS_ANCHOR_TEXTS = [
  'terms', 'terms of use', 'terms of service',
  'terms and conditions', 'tos', 'eula',
  'user agreement', 'conditions',
  'agb', 'allgemeine geschäftsbedingungen', 'nutzungsbedingungen',
  'cgu', 'cgv', 'conditions générales',
  'términos', 'términos y condiciones', 'condiciones de uso',
  'termini', 'termini e condizioni',
  'algemene voorwaarden', 'gebruiksvoorwaarden',
  'termos', 'termos de uso',
];

// ============================================================
//  Embedded markers (legal text on the page itself)
// ============================================================

export const EMBEDDED_IMPRINT_MARKERS = [
  // Deutsche Rechtsgrundlagen
  '§ 5 tmg', '§5 tmg', '§ 5 dsg',
  'angaben gemäß § 5', 'angaben gemäss § 5', 'angaben nach § 5',
  '§ 18 abs. 2 mstv', '§ 18 mstv',
  '§ 55 abs. 2 rstv', '§ 55 rstv',
  'verantwortlich für den inhalt',
  'verantwortlich für inhalt',
  'inhaltlich verantwortlich',
  // English markers
  'information according to § 5',
  'information pursuant to § 5',
  'imprint',
  'company information',
  'legal disclosure',
  // French markers (SARL/SAS-Pflichtangaben)
  'mentions légales',
  'directeur de la publication',
  // Generic heading markers
  'site notice',
];

// ============================================================
//  Path matching
// ============================================================

// Returns true when `urlPath` either equals one of the patterns
// exactly (after trailing-slash normalisation) OR when its last path
// segment equals one. Two-level matching catches both:
//   - `/datenschutz` matches `/datenschutz`
//   - `/de/datenschutz` matches `/datenschutz` (locale prefix)
//   - `/policies/privacy` matches `/privacy` (Shopify folder)
// while rejecting:
//   - `/blog/about-our-privacy-approach` against `/privacy`
//     (last segment `/about-our-privacy-approach` ≠ `/privacy`)
export function pathMatchesAny(urlPath: string, patterns: string[]): boolean {
  let path = urlPath;
  // Percent-decode so /datenschutzerkl%C3%A4rung also matches.
  // decodeURIComponent throws on malformed input; fall back to raw.
  try { path = decodeURIComponent(urlPath); } catch { /* ignore */ }

  const normalized = path
    .toLowerCase()
    .split('?')[0]
    .split('#')[0]
    .replace(/\/+$/, '');

  const segments = normalized.split('/').filter(Boolean);
  const lastSegment = segments.length > 0 ? '/' + segments[segments.length - 1] : '/';

  return patterns.some(p => {
    const normPattern = p.toLowerCase().replace(/\/+$/, '');
    return normalized === normPattern || lastSegment === normPattern;
  });
}

// ============================================================
//  Detection
// ============================================================

export interface LegalCheckResult {
  found: boolean;
  via: 'url' | 'embedded' | null;
  url?: string; // the matching page URL when via='url'
}

export interface LegalPageDetection {
  imprint: LegalCheckResult;
  privacy: LegalCheckResult;
  cookie: LegalCheckResult;
  terms: LegalCheckResult;
}

function findUrlMatch(pages: PageSEOData[], patterns: string[]): string | undefined {
  for (const p of pages) {
    let pathname: string;
    try {
      pathname = new URL(p.url).pathname;
    } catch {
      continue;
    }
    if (pathMatchesAny(pathname, patterns)) return p.url;
  }
  return undefined;
}

// `allHtmlLower` is the concatenation of all crawled-page HTML, already
// lowercased — passed by the caller because we only need it once and
// the audit pipeline already builds it.
export function detectLegalPages(pages: PageSEOData[], allHtmlLower: string): LegalPageDetection {
  const imprintUrl = findUrlMatch(pages, IMPRINT_URL_PATTERNS);
  const privacyUrl = findUrlMatch(pages, PRIVACY_URL_PATTERNS);
  const cookieUrl = findUrlMatch(pages, COOKIE_URL_PATTERNS);
  const termsUrl = findUrlMatch(pages, TERMS_URL_PATTERNS);

  // Imprint fallback: scan site HTML for explicit legal markers when
  // no URL matched. Catches non-conventional URL layouts where the
  // imprint lives on a slug like /info or /about with the right text.
  let imprintEmbedded = false;
  if (!imprintUrl) {
    imprintEmbedded = EMBEDDED_IMPRINT_MARKERS.some(m => allHtmlLower.includes(m));
  }

  return {
    imprint: imprintUrl
      ? { found: true, via: 'url', url: imprintUrl }
      : imprintEmbedded
        ? { found: true, via: 'embedded' }
        : { found: false, via: null },
    privacy: privacyUrl
      ? { found: true, via: 'url', url: privacyUrl }
      : { found: false, via: null },
    cookie: cookieUrl
      ? { found: true, via: 'url', url: cookieUrl }
      : { found: false, via: null },
    terms: termsUrl
      ? { found: true, via: 'url', url: termsUrl }
      : { found: false, via: null },
  };
}
