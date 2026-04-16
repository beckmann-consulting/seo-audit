import type { Finding, PageSEOData } from '@/types';
import { id } from './utils';

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

  // Viewport blocks zoom (accessibility)
  if (homepage.hasViewport && homepage.viewportBlocksZoom) {
    findings.push({
      id: id(), priority: 'important', module: 'ux', effort: 'low', impact: 'medium',
      title_de: 'Viewport blockiert Zoom (user-scalable=no oder maximum-scale < 2)',
      title_en: 'Viewport blocks zoom (user-scalable=no or maximum-scale < 2)',
      description_de: 'Nutzer können die Seite nicht zoomen — das ist eine schwere Barrierefreiheits-Einschränkung. iOS ignoriert diese Einstellung inzwischen, andere Plattformen nicht.',
      description_en: 'Users cannot zoom the page — a serious accessibility barrier. iOS now ignores this setting, but other platforms do not.',
      recommendation_de: 'Im Viewport-Tag "user-scalable=no" und "maximum-scale" entfernen. Empfohlener Wert: "width=device-width, initial-scale=1".',
      recommendation_en: 'Remove "user-scalable=no" and "maximum-scale" from the viewport tag. Recommended value: "width=device-width, initial-scale=1".',
    });
  }

  // Viewport missing initial-scale
  if (homepage.hasViewport && !homepage.viewportHasInitialScale) {
    findings.push({
      id: id(), priority: 'recommended', module: 'ux', effort: 'low', impact: 'low',
      title_de: 'Viewport ohne initial-scale=1',
      title_en: 'Viewport missing initial-scale=1',
      description_de: '"initial-scale=1" sorgt für konsistentes Rendering beim ersten Laden auf allen Geräten und Orientierungen.',
      description_en: '"initial-scale=1" ensures consistent rendering on first load across all devices and orientations.',
      recommendation_de: 'Viewport-Tag um "initial-scale=1" ergänzen.',
      recommendation_en: 'Add "initial-scale=1" to the viewport tag.',
    });
  }

  // Horizontal overflow risk: pages with many fixed-width elements > 400px
  const pagesWithFixedWidth = pages.filter(p => p.fixedWidthElements >= 3);
  if (pagesWithFixedWidth.length > 0) {
    const total = pagesWithFixedWidth.reduce((s, p) => s + p.fixedWidthElements, 0);
    findings.push({
      id: id(), priority: 'recommended', module: 'ux', effort: 'medium', impact: 'medium',
      title_de: `Fixe Breiten > 400px: ${total} Elemente auf ${pagesWithFixedWidth.length} Seiten`,
      title_en: `Fixed widths > 400px: ${total} elements on ${pagesWithFixedWidth.length} pages`,
      description_de: 'Inline-Styles mit festen Pixel-Breiten (ohne max-width) verursachen auf schmalen Mobil-Viewports horizontales Scrollen — Google stuft dies als mobile-usability-Problem ein.',
      description_en: 'Inline styles with fixed pixel widths (without max-width) cause horizontal scrolling on narrow mobile viewports — Google flags this as a mobile usability issue.',
      recommendation_de: 'Feste px-Breiten durch relative Einheiten (%, vw, rem) ersetzen oder "max-width: 100%" ergänzen. Bilder mit responsive srcset versehen.',
      recommendation_en: 'Replace fixed px widths with relative units (%, vw, rem) or add "max-width: 100%". Add responsive srcset to images.',
    });
  }

  // Small inline font sizes
  const pagesWithSmallFonts = pages.filter(p => p.smallFontElements >= 2);
  if (pagesWithSmallFonts.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'ux', effort: 'low', impact: 'medium',
      title_de: `Schriftgrößen < 12px auf ${pagesWithSmallFonts.length} Seiten`,
      title_en: `Font sizes < 12px on ${pagesWithSmallFonts.length} pages`,
      description_de: 'Sehr kleine Schriftgrößen sind auf Mobilgeräten schwer lesbar. Google empfiehlt Body-Text mindestens 16px, Annotationen nicht unter 12px.',
      description_en: 'Very small font sizes are hard to read on mobile. Google recommends body text at least 16px, annotations not below 12px.',
      recommendation_de: 'Schriftgrößen im CSS auf mind. 16px für Fließtext und 12px für sekundäre Texte anheben.',
      recommendation_en: 'Increase CSS font sizes to at least 16px for body text and 12px for secondary text.',
    });
  }

  // Legacy plugins (Flash etc.)
  const pagesWithLegacyPlugins = pages.filter(p => p.legacyPlugins > 0);
  if (pagesWithLegacyPlugins.length > 0) {
    findings.push({
      id: id(), priority: 'critical', module: 'ux', effort: 'high', impact: 'high',
      title_de: `Legacy-Plugin-Inhalte (Flash/Shockwave) auf ${pagesWithLegacyPlugins.length} Seiten`,
      title_en: `Legacy plugin content (Flash/Shockwave) on ${pagesWithLegacyPlugins.length} pages`,
      description_de: 'Flash wurde 2020 eingestellt und wird von keinem modernen Browser mehr unterstützt. Diese Inhalte sind für alle Nutzer unsichtbar.',
      description_en: 'Flash was discontinued in 2020 and is not supported by any modern browser. This content is invisible to all users.',
      recommendation_de: 'Flash-Inhalte durch HTML5-Video, Canvas oder moderne JavaScript-Frameworks ersetzen.',
      recommendation_en: 'Replace Flash content with HTML5 video, Canvas or modern JavaScript frameworks.',
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

  // Internal linking finding moved to generateSEOFindings as part of D2
  // module reassignment — it primarily affects crawlability and link
  // equity distribution, not user experience.

  return findings;
}


// Check 3 — Font loading
export function generateFontLoadingFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  const homepage = pages[0];
  if (!homepage) return findings;

  if (homepage.hasExternalFonts && homepage.fontPreloads === 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'ux', effort: 'low', impact: 'low',
      title_de: 'Externe Fonts ohne <link rel="preload">',
      title_en: 'External fonts without <link rel="preload">',
      description_de: 'Es werden externe Fonts (z.B. Google Fonts, Adobe Fonts) geladen, aber keine per <link rel="preload" as="font"> vorangestellt. Das verzögert das erste Rendern kritischer Typografie und sorgt für FOUT/FOIT.',
      description_en: 'External fonts (e.g. Google Fonts, Adobe Fonts) are loaded, but none are preloaded via <link rel="preload" as="font">. This delays first paint of critical typography and causes FOUT/FOIT.',
      recommendation_de: 'Kritische Fonts (z.B. den Haupt-Body-Font) im <head> als preload deklarieren: <link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>.',
      recommendation_en: 'Preload critical fonts (e.g. the main body font) in <head>: <link rel="preload" href="/fonts/main.woff2" as="font" type="font/woff2" crossorigin>.',
    });
  }

  if (!homepage.hasFontDisplaySwap && homepage.hasExternalFonts) {
    findings.push({
      id: id(), priority: 'optional', module: 'ux', effort: 'low', impact: 'low',
      title_de: 'Kein font-display: swap erkannt',
      title_en: 'No font-display: swap detected',
      description_de: 'Inline-CSS enthält keine font-display: swap-Deklaration. Ohne swap zeigen Browser bis zu 3 Sekunden unsichtbaren Text (FOIT), bis die Webfont geladen ist — LCP leidet.',
      description_en: 'Inline CSS has no font-display: swap declaration. Without swap, browsers show invisible text for up to 3 seconds (FOIT) until the webfont loads — LCP suffers.',
      recommendation_de: 'Bei selbst gehosteten Fonts: @font-face { ... font-display: swap; }. Bei Google Fonts: &display=swap an die URL anhängen. So zeigt der Browser sofort eine Fallback-Schrift und tauscht sie nahtlos aus.',
      recommendation_en: 'For self-hosted fonts: @font-face { ... font-display: swap; }. For Google Fonts: append &display=swap to the URL. The browser then shows a fallback font immediately and swaps seamlessly.',
    });
  }

  return findings;
}

// Check 5 — Favicon / touch icons / web manifest
export function generateFaviconFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  // Only check the homepage (depth 0) — per-page checks would be noise
  const homepage = pages.find(p => p.depth === 0) || pages[0];
  if (!homepage) return findings;

  if (!homepage.hasFavicon) {
    findings.push({
      id: id(), priority: 'important', module: 'ux', effort: 'low', impact: 'medium',
      title_de: 'Kein Favicon',
      title_en: 'No favicon',
      description_de: 'Es wurde kein <link rel="icon"> oder <link rel="shortcut icon"> gefunden. Browser zeigen ohne Favicon ein generisches Platzhalter-Icon im Tab, Bookmarks und Browser-History — ein sofortiger Vertrauensverlust und Brand-Signal.',
      description_en: 'No <link rel="icon"> or <link rel="shortcut icon"> was found. Without a favicon, browsers show a generic placeholder icon in the tab, bookmarks and browser history — an immediate loss of trust and brand signal.',
      recommendation_de: 'Favicon im <head> ergänzen: <link rel="icon" href="/favicon.ico">. Zusätzlich empfohlen: <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"> für hochauflösende Displays.',
      recommendation_en: 'Add a favicon in <head>: <link rel="icon" href="/favicon.ico">. Additionally recommended: <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"> for high-DPI displays.',
      affectedUrl: homepage.url,
    });
  }

  if (!homepage.hasAppleTouchIcon) {
    findings.push({
      id: id(), priority: 'optional', module: 'ux', effort: 'low', impact: 'low',
      title_de: 'Kein Apple Touch Icon',
      title_en: 'No apple-touch-icon',
      description_de: 'Wenn iOS-Nutzer die Seite zum Home-Screen hinzufügen, fällt iOS auf einen Screenshot der Seite zurück. Ein explizites apple-touch-icon sorgt für ein professionelles App-ähnliches Icon.',
      description_en: 'When iOS users add the site to their home screen, iOS falls back to a screenshot of the page. An explicit apple-touch-icon provides a professional app-like icon.',
      recommendation_de: 'Im <head> ergänzen: <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">. PNG mit 180x180 Pixeln, ohne transparenten Hintergrund.',
      recommendation_en: 'Add to <head>: <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">. PNG at 180x180 pixels, without transparent background.',
      affectedUrl: homepage.url,
    });
  }

  if (!homepage.hasWebManifest) {
    findings.push({
      id: id(), priority: 'optional', module: 'ux', effort: 'low', impact: 'low',
      title_de: 'Kein Web-App-Manifest',
      title_en: 'No web app manifest',
      description_de: 'Ein manifest.json macht die Seite zur installierbaren PWA und verbessert das Verhalten auf Android-Home-Screens (eigener Splash-Screen, Theme-Color, App-Name).',
      description_en: 'A manifest.json turns the site into an installable PWA and improves Android home-screen behaviour (custom splash screen, theme color, app name).',
      recommendation_de: 'Ein minimales /manifest.json erstellen (name, icons, theme_color, background_color) und per <link rel="manifest" href="/manifest.json"> einbinden.',
      recommendation_en: 'Create a minimal /manifest.json (name, icons, theme_color, background_color) and link it via <link rel="manifest" href="/manifest.json">.',
      affectedUrl: homepage.url,
    });
  }

  return findings;
}

