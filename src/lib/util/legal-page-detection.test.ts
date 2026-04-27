import { describe, it, expect } from 'vitest';
import {
  pathMatchesAny,
  detectLegalPages,
  IMPRINT_URL_PATTERNS,
  PRIVACY_URL_PATTERNS,
  COOKIE_URL_PATTERNS,
  TERMS_URL_PATTERNS,
} from './legal-page-detection';
import type { PageSEOData } from '@/types';

function pageAt(url: string): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: 0, hasCanonical: true,
    renderBlockingScripts: 0, modernImageFormats: 0, lazyLoadedImages: 0,
    hreflangs: [],
    viewportBlocksZoom: false, viewportHasInitialScale: true,
    fixedWidthElements: 0, smallFontElements: 0, legacyPlugins: 0,
    likelyClientRendered: false,
    genericAnchors: [], emptyAnchors: 0, hasNoindex: false,
    imageDetails: [], fontPreloads: 0, hasFontDisplaySwap: false, hasExternalFonts: false,
    thirdPartyScripts: [],
    hasFavicon: true, hasAppleTouchIcon: true, hasWebManifest: true, hasThemeColor: true,
    httpStatus: 200, protocol: null,
    headingStructure: [], hasPaginationLinks: false, paginationUrls: [],
    hasAuthorSignal: true, hasDateSignal: true, externalLinksDetailed: [],
    xRobotsNoindex: false, xRobotsBotSpecific: [],
    hasJsonLd: false, hasMicrodata: false, hasRdfa: false,
    bodyTextHash: '', bodyMinhash: [], textHtmlRatio: 0.2, smallTouchTargetCount: 0,
  };
}

// ============================================================
//  pathMatchesAny — the four spec acceptance cases
// ============================================================

describe('pathMatchesAny — spec acceptance cases', () => {
  it('does NOT match /blog/about-our-privacy-approach as a privacy page', () => {
    expect(pathMatchesAny('/blog/about-our-privacy-approach', PRIVACY_URL_PATTERNS)).toBe(false);
  });

  it('matches /de/datenschutz (locale prefix) as a privacy page', () => {
    expect(pathMatchesAny('/de/datenschutz', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('matches Shopify-style /policies/privacy as a privacy page', () => {
    expect(pathMatchesAny('/policies/privacy', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('matches Webflow-style /footer/legal as an imprint', () => {
    expect(pathMatchesAny('/footer/legal', IMPRINT_URL_PATTERNS)).toBe(true);
  });
});

describe('pathMatchesAny — substring false-positive guard', () => {
  it('rejects /products/cookie-cutter', () => {
    expect(pathMatchesAny('/products/cookie-cutter', COOKIE_URL_PATTERNS)).toBe(false);
  });

  it('rejects /careers/legal-counsel', () => {
    expect(pathMatchesAny('/careers/legal-counsel', IMPRINT_URL_PATTERNS)).toBe(false);
  });

  it('rejects /info/terms-of-art-pieces', () => {
    expect(pathMatchesAny('/info/terms-of-art-pieces', TERMS_URL_PATTERNS)).toBe(false);
  });
});

describe('pathMatchesAny — full-path matches', () => {
  it('matches the exact pattern path', () => {
    expect(pathMatchesAny('/datenschutz', PRIVACY_URL_PATTERNS)).toBe(true);
    expect(pathMatchesAny('/impressum', IMPRINT_URL_PATTERNS)).toBe(true);
    expect(pathMatchesAny('/agb', TERMS_URL_PATTERNS)).toBe(true);
  });

  it('handles trailing slashes equivalently', () => {
    expect(pathMatchesAny('/datenschutz/', PRIVACY_URL_PATTERNS)).toBe(true);
    expect(pathMatchesAny('/datenschutz', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('strips query strings + fragments before comparison', () => {
    expect(pathMatchesAny('/datenschutz?utm=foo', PRIVACY_URL_PATTERNS)).toBe(true);
    expect(pathMatchesAny('/datenschutz#section-2', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(pathMatchesAny('/Datenschutz', PRIVACY_URL_PATTERNS)).toBe(true);
    expect(pathMatchesAny('/IMPRESSUM', IMPRINT_URL_PATTERNS)).toBe(true);
  });

  it('decodes percent-encoded umlauts (/datenschutzerklärung)', () => {
    // %C3%A4 = ä in UTF-8. Real-world URLs serve umlaut paths this way.
    expect(pathMatchesAny('/datenschutzerkl%C3%A4rung', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('tolerates malformed percent-encodings without throwing', () => {
    expect(() => pathMatchesAny('/x%ZZ%y/datenschutz', PRIVACY_URL_PATTERNS)).not.toThrow();
  });

  it('recognises /policies/cookies (Shopify) as a cookie policy', () => {
    expect(pathMatchesAny('/policies/cookies', COOKIE_URL_PATTERNS)).toBe(true);
  });

  it('recognises /utility/privacy (Webflow utility folder) as a privacy page', () => {
    expect(pathMatchesAny('/utility/privacy', PRIVACY_URL_PATTERNS)).toBe(true);
  });
});

describe('pathMatchesAny — multilingual coverage', () => {
  it('matches French privacy URL', () => {
    expect(pathMatchesAny('/politique-de-confidentialite', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('matches Italian privacy URL', () => {
    expect(pathMatchesAny('/informativa-sulla-privacy', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('matches Polish privacy URL', () => {
    expect(pathMatchesAny('/polityka-prywatnosci', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('matches Swedish privacy URL', () => {
    expect(pathMatchesAny('/integritetspolicy', PRIVACY_URL_PATTERNS)).toBe(true);
  });

  it('matches French imprint URL', () => {
    expect(pathMatchesAny('/mentions-legales', IMPRINT_URL_PATTERNS)).toBe(true);
  });

  it('matches Italian imprint URL', () => {
    expect(pathMatchesAny('/note-legali', IMPRINT_URL_PATTERNS)).toBe(true);
  });

  it('matches French terms URL (CGU/CGV)', () => {
    expect(pathMatchesAny('/cgu', TERMS_URL_PATTERNS)).toBe(true);
    expect(pathMatchesAny('/cgv', TERMS_URL_PATTERNS)).toBe(true);
  });

  it('matches German terms URL (AGB)', () => {
    expect(pathMatchesAny('/agb', TERMS_URL_PATTERNS)).toBe(true);
  });
});

// ============================================================
//  detectLegalPages
// ============================================================

describe('detectLegalPages', () => {
  it('returns all-not-found on a site with only blog pages', () => {
    const r = detectLegalPages([
      pageAt('https://x.com/'),
      pageAt('https://x.com/blog/post-1'),
    ], '');
    expect(r.imprint.found).toBe(false);
    expect(r.privacy.found).toBe(false);
    expect(r.cookie.found).toBe(false);
    expect(r.terms.found).toBe(false);
  });

  it('finds an imprint by URL pattern and reports via=url with the matching URL', () => {
    const r = detectLegalPages([
      pageAt('https://x.com/'),
      pageAt('https://x.com/impressum'),
    ], '');
    expect(r.imprint.found).toBe(true);
    expect(r.imprint.via).toBe('url');
    expect(r.imprint.url).toBe('https://x.com/impressum');
  });

  it('finds an imprint by EMBEDDED MARKER when no URL matches', () => {
    const r = detectLegalPages(
      [pageAt('https://x.com/'), pageAt('https://x.com/some-custom-page')],
      '<html>...angaben gemäß § 5 tmg sind...</html>',
    );
    expect(r.imprint.found).toBe(true);
    expect(r.imprint.via).toBe('embedded');
    expect(r.imprint.url).toBeUndefined();
  });

  it('prefers via=url over via=embedded when both are possible', () => {
    const r = detectLegalPages(
      [pageAt('https://x.com/impressum')],
      '§ 5 tmg verantwortlich für den inhalt',
    );
    expect(r.imprint.via).toBe('url');
  });

  it('does NOT trigger embedded fallback for privacy/cookie/terms (only imprint)', () => {
    // Privacy / cookie / terms have no equivalent legally-mandatory
    // boilerplate, so we don't have an EMBEDDED_PRIVACY_MARKERS list.
    const r = detectLegalPages(
      [pageAt('https://x.com/')],
      'we care about your privacy and use cookies',
    );
    expect(r.privacy.found).toBe(false);
    expect(r.cookie.found).toBe(false);
  });

  it('finds Shopify-style privacy at /policies/privacy', () => {
    const r = detectLegalPages([pageAt('https://shop.com/policies/privacy')], '');
    expect(r.privacy.found).toBe(true);
    expect(r.privacy.url).toBe('https://shop.com/policies/privacy');
  });

  it('finds privacy on a French-locale-prefixed URL', () => {
    const r = detectLegalPages([pageAt('https://x.com/fr/politique-de-confidentialite')], '');
    expect(r.privacy.found).toBe(true);
  });

  it('does NOT confuse a blog post containing privacy-keyword as a privacy page', () => {
    const r = detectLegalPages(
      [pageAt('https://x.com/blog/about-our-privacy-approach')],
      '',
    );
    expect(r.privacy.found).toBe(false);
  });

  it('finds terms (AGB) via German pattern', () => {
    const r = detectLegalPages([pageAt('https://x.com/agb')], '');
    expect(r.terms.found).toBe(true);
  });

  it('finds cookie policy via Webflow pattern /footer/cookies', () => {
    const r = detectLegalPages([pageAt('https://x.com/footer/cookies')], '');
    expect(r.cookie.found).toBe(true);
  });

  it('handles malformed page URLs without crashing', () => {
    expect(() => detectLegalPages(
      [{ ...pageAt('https://x.com/'), url: 'not-a-real-url' }],
      '',
    )).not.toThrow();
  });
});
