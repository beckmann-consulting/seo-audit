import { parse } from 'node-html-parser';
import { detectLanguage } from './util/lang-detect';
import type { PageData, PageSEOData, ParsedSchema } from '@/types';
import { parseXRobotsTag, xRobotsImpliesNoindex } from './util/x-robots';
import { measurePixelWidth } from './util/pixel-width';
import { extractMicrodata, extractRdfa, hasMicrodata, hasRdfa } from './structured-data';
import {
  normalizeBodyText, fnv1aHex, buildShingles, minhashSignature,
} from './util/text-similarity';
import {
  fleschReadingEase, pickReadabilityLang,
} from './util/readability';
import { countSmallTouchTargets } from './util/touch-targets';
import { detectCsrFromRoot } from './util/csr-detection';

// Pages with fewer words than this skip duplicate fingerprinting —
// shingling needs ≥ k words to produce anything, and very thin pages
// are flagged separately by content-length checks anyway.
const MIN_WORDS_FOR_FINGERPRINT = 50;

// Flesch scoring is only meaningful on prose-length samples. Below
// this we'd be measuring noise (a single 50-word paragraph can score
// anywhere from 20 to 90 just based on which words appear).
const MIN_WORDS_FOR_READABILITY = 200;

// Third-party script domain → category (used by Check 4).
// CDN domains like unpkg / cdnjs / jsdelivr intentionally map to "cdn" and
// are NOT counted against the "too many trackers" heuristic.
function categorizeScriptDomain(host: string, path = ''): string | null {
  const h = host.toLowerCase();
  if (/(google-analytics\.com|googletagmanager\.com|gtag)/i.test(h)) return 'analytics';
  if (/(doubleclick\.net|googlesyndication\.com|adsystem|adservice)/i.test(h)) return 'ads';
  // ultimate-41: the Meta pixel loads fbevents.js from connect.facebook.net. The former pattern tested
  // "facebook.net/tr" against a host name and could never match.
  if (h === 'connect.facebook.net' && /\/fbevents\.js$/i.test(path)) return 'ads';
  if (/(hotjar\.com|clarity\.ms|fullstory\.com|mouseflow\.com|luckyorange\.com)/i.test(h)) return 'heatmap';
  if (/(connect\.facebook\.net|platform\.twitter\.com|platform\.linkedin\.com|apis\.google\.com)/i.test(h)) return 'social';
  if (/(cdnjs\.cloudflare\.com|unpkg\.com|jsdelivr\.net|cdn\.jsdelivr\.net|bootstrapcdn\.com)/i.test(h)) return 'cdn';
  // Generic external script that we can't classify yet
  return 'other';
}

// ultimate-41 (point 1): whether a <script src> blocks rendering. Boolean attributes count when present, also
// empty (`defer=""`); node-html-parser gives '' for a bare `defer`, which the former `!getAttribute('defer')` read as
// absent. Module scripts are deferred by the HTML standard; scripts of another type (text/plain of a consent tool,
// JSON) are not run at all.
export function isRenderBlockingScript(el: { hasAttribute(name: string): boolean; getAttribute(name: string): string | undefined | null }): boolean {
  if (el.hasAttribute('async') || el.hasAttribute('defer')) return false;
  const type = (el.getAttribute('type') ?? '').trim().toLowerCase();
  if (type === '') return true;
  if (type === 'module') return false;
  return /^(text|application)\/(x-)?(java|ecma|j|live)script(\s*;.*)?$/.test(type);
}

// ultimate-41 (point 17): tracking snippets written inline, without a <script src> to a tracker host
const INLINE_TRACKERS: { name: string; re: RegExp }[] = [
  { name: 'gtag', re: /\bgtag\s*\(/ },
  { name: 'google-tag-manager', re: /googletagmanager\.com\/gtm\.js/ },
  { name: 'meta-pixel', re: /\bfbq\s*\(/ },
  { name: 'matomo', re: /\b_paq\.push\s*\(/ },
  { name: 'hotjar', re: /\bhj\s*\(|static\.hotjar\.com/ },
];

export function inlineTrackersIn(scriptTexts: string[]): string[] {
  const found: string[] = [];
  for (const t of INLINE_TRACKERS) if (scriptTexts.some(s => t.re.test(s))) found.push(t.name);
  return found;
}

// Generic anchor text blacklist (DE + EN). Normalised to lowercase, trimmed.
export const GENERIC_ANCHOR_TEXTS = new Set([
  // DE
  'hier', 'hier klicken', 'mehr erfahren', 'weiter', 'weiterlesen',
  'klicken sie hier', 'jetzt klicken', 'link', 'seite', 'öffnen',
  'mehr', 'klick', 'klicken',
  // EN
  'click here', 'here', 'read more', 'learn more', 'more',
  'page', 'click', 'open', 'continue', 'this link', 'this page',
  'read', 'see more', 'find out more',
]);

function collectSchemas(node: unknown, out: ParsedSchema[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectSchemas(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  // @graph is a container, flatten its items
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) collectSchemas(item, out);
  }
  const rawType = obj['@type'];
  if (typeof rawType === 'string') {
    out.push({ type: rawType, data: obj });
  } else if (Array.isArray(rawType)) {
    // Schema.org allows multiple types; use the first as the primary
    const first = rawType.find(t => typeof t === 'string');
    if (typeof first === 'string') out.push({ type: first, data: obj });
  }
}

export function extractPageSEO(page: PageData): PageSEOData {
  const root = parse(page.html, { comment: false });

  // Title
  const titleEl = root.querySelector('title');
  const title = titleEl?.text?.trim();

  // Meta description
  const metaDesc = root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();

  // Headings (per-level lists + full ordered structure)
  const h1s = root.querySelectorAll('h1').map(h => h.text.trim()).filter(Boolean);
  const h2s = root.querySelectorAll('h2').map(h => h.text.trim()).filter(Boolean);
  const h3s = root.querySelectorAll('h3').map(h => h.text.trim()).filter(Boolean);
  const headingStructure: { level: number; text: string }[] = [];
  const allHeadings = root.querySelectorAll('h1, h2, h3, h4, h5, h6');
  for (const h of allHeadings) {
    const tag = h.tagName.toLowerCase();
    const level = parseInt(tag.slice(1), 10);
    const text = h.text.trim();
    if (!Number.isNaN(level) && level >= 1 && level <= 6) {
      headingStructure.push({ level, text });
    }
  }

  // Canonical
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim();

  // Pagination — <link rel="next"> / <link rel="prev">
  const paginationLinks = root.querySelectorAll('link[rel="next"], link[rel="prev"]');
  const paginationUrls: string[] = [];
  for (const el of paginationLinks) {
    const href = el.getAttribute('href')?.trim();
    if (!href) continue;
    try {
      paginationUrls.push(new URL(href, page.url).href);
    } catch {
      paginationUrls.push(href);
    }
  }
  const hasPaginationLinks = paginationUrls.length > 0;

  // Hreflang (link[rel~="alternate"][hreflang]). ultimate-41: rel is a list of words, so "alternate nofollow" counts
  const hreflangEls = root.querySelectorAll('link[hreflang]').filter(el => (el.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('alternate'));
  const hreflangs = hreflangEls
    .map(el => ({
      hreflang: (el.getAttribute('hreflang') || '').trim(),
      href: (el.getAttribute('href') || '').trim(),
    }))
    .filter(x => x.hreflang && x.href)
    .map(x => {
      // Resolve relative URLs to absolute
      try {
        return { hreflang: x.hreflang, href: new URL(x.href, page.url).href };
      } catch {
        return x;
      }
    });

  // OG tags (Open Graph)
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim();
  const ogImage = root.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim();
  const ogImageWidthStr = root.querySelector('meta[property="og:image:width"]')?.getAttribute('content')?.trim();
  const ogImageHeightStr = root.querySelector('meta[property="og:image:height"]')?.getAttribute('content')?.trim();
  const ogImageWidth = ogImageWidthStr ? parseInt(ogImageWidthStr, 10) : undefined;
  const ogImageHeight = ogImageHeightStr ? parseInt(ogImageHeightStr, 10) : undefined;
  const ogImageType = root.querySelector('meta[property="og:image:type"]')?.getAttribute('content')?.trim();
  const ogLocale = root.querySelector('meta[property="og:locale"]')?.getAttribute('content')?.trim();

  // Twitter card
  const twitterCard = root.querySelector('meta[name="twitter:card"]')?.getAttribute('content')?.trim();
  const twitterTitle = root.querySelector('meta[name="twitter:title"]')?.getAttribute('content')?.trim();
  const twitterDescription = root.querySelector('meta[name="twitter:description"]')?.getAttribute('content')?.trim();
  const twitterImage = root.querySelector('meta[name="twitter:image"]')?.getAttribute('content')?.trim();

  // HTML lang
  const lang = root.querySelector('html')?.getAttribute('lang')?.trim();

  // Meta robots — look for noindex in <meta name="robots"> or <meta name="googlebot">
  const robotsMeta = root.querySelector('meta[name="robots" i]')?.getAttribute('content') || '';
  const googlebotMeta = root.querySelector('meta[name="googlebot" i]')?.getAttribute('content') || '';
  // ultimate-41 (point 18): "none" means noindex, nofollow, as in the X-Robots-Tag parser (util/x-robots.ts)
  const hasNoindex = /\b(noindex|none)\b/i.test(robotsMeta) || /\b(noindex|none)\b/i.test(googlebotMeta);

  // X-Robots-Tag (HTTP response header) — parsed alongside <meta robots>
  // because the two can disagree, and the union is what Google obeys.
  const xRobotsParsed = parseXRobotsTag(page.xRobotsTag);
  const xRobotsNoindex = xRobotsImpliesNoindex(xRobotsParsed);
  const xRobotsBotSpecific = xRobotsParsed?.botSpecific ?? [];

  // Viewport
  const viewportContent = root.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
  const hasViewport = viewportContent.includes('width=device-width');
  // Zoom blocked when user-scalable=no OR maximum-scale < ~2 (both hurt accessibility)
  const userScalableNo = /user-scalable\s*=\s*(no|0)/i.test(viewportContent);
  const maxScaleMatch = viewportContent.match(/maximum-scale\s*=\s*([\d.]+)/i);
  const maxScaleBlocks = maxScaleMatch ? parseFloat(maxScaleMatch[1]) < 2 : false;
  const viewportBlocksZoom = userScalableNo || maxScaleBlocks;
  const viewportHasInitialScale = /initial-scale\s*=\s*[\d.]+/i.test(viewportContent);

  // Charset
  const hasCharset = !!root.querySelector('meta[charset]');

  // Schema.org — JSON-LD (the primary path), Microdata, and RDFa.
  // All three formats normalize to the same ParsedSchema shape so the
  // per-type required-field validation in seo.ts works regardless.
  const schemaScripts = root.querySelectorAll('script[type="application/ld+json"]');
  const schemas: ParsedSchema[] = [];
  let schemaParseErrors = 0;
  schemaScripts.forEach(s => {
    try {
      const json = JSON.parse(s.text);
      collectSchemas(json, schemas);
    } catch {
      schemaParseErrors++;
    }
  });
  const hasJsonLd = schemaScripts.length > 0;

  const microdataItems = extractMicrodata(root);
  schemas.push(...microdataItems);
  const pageHasMicrodata = hasMicrodata(root);

  const rdfaItems = extractRdfa(root);
  schemas.push(...rdfaItems);
  const pageHasRdfa = hasRdfa(root);

  const schemaTypes: string[] = schemas.map(s => s.type);

  // Images + per-image details for Check 2
  const images = root.querySelectorAll('img');
  const imagesMissingAlt = images.filter(img => {
    const alt = img.getAttribute('alt');
    return alt === null || alt === undefined;
  }).length;
  // ultimate-41 (point 16): modern means WebP, AVIF or SVG (a vector needs no raster alternative), also an <img>
  // inside a <picture> that offers a WebP or AVIF <source>
  const modernImageFormats = images.filter(img => {
    const src = img.getAttribute('src') || '';
    if (/\.(webp|avif|svg)(\?|#|$)/i.test(src) || /^data:image\/svg\+xml/i.test(src)) return true;
    const parent = img.parentNode as unknown as { rawTagName?: string; querySelectorAll?: (sel: string) => { getAttribute(n: string): string | undefined }[] } | null;
    if (parent?.rawTagName?.toLowerCase() !== 'picture' || !parent.querySelectorAll) return false;
    return parent.querySelectorAll('source').some(srcEl => /^image\/(webp|avif)$/i.test((srcEl.getAttribute('type') || '').trim()));
  }).length;
  const lazyLoadedImages = images.filter(img => img.getAttribute('loading') === 'lazy').length;
  const imageDetails = images.map(img => {
    const widthAttr = img.getAttribute('width');
    const declaredWidth = widthAttr ? parseInt(widthAttr, 10) : undefined;
    return {
      src: img.getAttribute('src') || '',
      hasWidth: !!widthAttr,
      hasHeight: !!img.getAttribute('height'),
      isLazy: img.getAttribute('loading') === 'lazy',
      hasSrcset: !!img.getAttribute('srcset'),
      declaredWidth: declaredWidth !== undefined && !Number.isNaN(declaredWidth) ? declaredWidth : undefined,
    };
  });

  // Links + anchor text analysis
  const allLinks = root.querySelectorAll('a[href]');
  const pageHost = (() => { try { return new URL(page.url).hostname; } catch { return ''; } })();
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  const externalLinksDetailed: { href: string; hasNofollow: boolean; hasNoopener: boolean }[] = [];
  const genericAnchors: { text: string; href: string }[] = [];
  let emptyAnchors = 0;
  allLinks.forEach(a => {
    const href = a.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;

    let absoluteHref: string | undefined;
    let isInternal = false;
    try {
      const u = new URL(href, page.url);
      absoluteHref = u.href;
      isInternal = u.hostname === pageHost;
      if (isInternal) internalLinks.push(u.href);
      else if (href.startsWith('http')) externalLinks.push(u.href);
    } catch {
      return;
    }

    // External link detail (rel attributes) for Block D1
    if (!isInternal && absoluteHref) {
      const rel = (a.getAttribute('rel') || '').toLowerCase();
      externalLinksDetailed.push({
        href: absoluteHref,
        hasNofollow: /\bnofollow\b/.test(rel),
        hasNoopener: /\bnoopener\b/.test(rel) || /\bnoreferrer\b/.test(rel),
      });
    }

    if (!isInternal || !absoluteHref) return;

    // Anchor text quality — only for internal links, as external anchors
    // affect another site's SEO, not ours.
    const rawText = a.text.replace(/\s+/g, ' ').trim();
    const ariaLabel = (a.getAttribute('aria-label') || '').trim();
    const title = (a.getAttribute('title') || '').trim();
    const hasImgChild = !!a.querySelector('img[alt]');

    if (!rawText && !ariaLabel && !title && !hasImgChild) {
      emptyAnchors++;
      return;
    }

    const normalised = rawText.toLowerCase();
    if (rawText && GENERIC_ANCHOR_TEXTS.has(normalised)) {
      genericAnchors.push({ text: rawText, href: absoluteHref });
    }
  });

  // E-E-A-T signals — author and publication/modification date
  const hasAuthorMeta = !!root.querySelector('meta[name="author" i]');
  const hasAuthorRel = !!root.querySelector('a[rel="author" i], link[rel="author" i]');
  const hasAuthorSchema = schemas.some(s => {
    const author = s.data['author'];
    if (!author) return false;
    if (typeof author === 'string') return author.trim().length > 0;
    if (Array.isArray(author)) return author.length > 0;
    if (typeof author === 'object') return Object.keys(author as Record<string, unknown>).length > 0;
    return false;
  });
  const hasAuthorSignal = hasAuthorMeta || hasAuthorRel || hasAuthorSchema;

  const hasTimeTag = !!root.querySelector('time[datetime], time[pubdate]');
  const hasArticlePublishedMeta = !!root.querySelector(
    'meta[property="article:published_time"], meta[property="article:modified_time"], meta[name="date" i], meta[name="pubdate" i]'
  );
  const hasDateSchema = schemas.some(s => !!s.data['datePublished'] || !!s.data['dateModified']);
  const hasDateSignal = hasTimeTag || hasArticlePublishedMeta || hasDateSchema;

  // Word count + sample for downstream content analysis
  const body = root.querySelector('body');
  const bodyText = body ? body.text.replace(/\s+/g, ' ').trim() : '';
  const wordCount = bodyText.split(' ').filter(w => w.length > 2).length;
  const bodyTextSample = bodyText.slice(0, 2000);

  // Body fingerprints for duplicate detection. We compute these here
  // (where the full body text is in scope) and only retain the hash +
  // signature on PageSEOData, not the source text.
  let bodyTextHash = '';
  let bodyMinhash: number[] = [];
  if (wordCount >= MIN_WORDS_FOR_FINGERPRINT) {
    const normalised = normalizeBodyText(bodyText);
    bodyTextHash = fnv1aHex(normalised);
    bodyMinhash = minhashSignature(buildShingles(normalised));
  }

  // Readability: Flesch Reading Ease (EN) / Flesch-Amstad (DE).
  // Computed from the visible body text once we know we have enough
  // of it. Language is inferred from <html lang>; default English.
  let readabilityScore: number | undefined;
  let readabilityLang: 'de' | 'en' | undefined;
  if (wordCount >= MIN_WORDS_FOR_READABILITY) {
    readabilityLang = pickReadabilityLang(lang);
    readabilityScore = fleschReadingEase(bodyText, readabilityLang);
  }

  // Text-to-HTML ratio: visible body text length divided by raw HTML
  // length. Walking the DOM and skipping script/style/noscript children
  // is necessary because node-html-parser's body.text concatenates
  // script content as text — including it would mis-classify SPAs
  // (huge inline JS, almost no real content) as "content-rich".
  let visibleBodyRaw = '';
  const collectVisible = (node: { nodeType: number; tagName?: string; rawText?: string; text?: string; childNodes?: { nodeType: number; tagName?: string; rawText?: string; text?: string; childNodes?: unknown[] }[] }): void => {
    if (!node) return;
    if (node.nodeType === 3) { // text node
      visibleBodyRaw += node.rawText ?? node.text ?? '';
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName?.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
    for (const child of node.childNodes ?? []) {
      collectVisible(child as Parameters<typeof collectVisible>[0]);
    }
  };
  if (body) collectVisible(body as unknown as Parameters<typeof collectVisible>[0]);
  const visibleBodyText = visibleBodyRaw.replace(/\s+/g, ' ').trim();
  const textHtmlRatio = page.html.length > 0 ? visibleBodyText.length / page.html.length : 0;

  // ultimate-41 (point 5): the language of the visible text, from function words (lib/util/lang-detect.ts), read
  // from at most the first 5 000 words; no answer when the evidence is not clear
  const guess = detectLanguage(visibleBodyText.split(' ').slice(0, 5000).join(' '));
  const detectedLang = guess ? { lang: guess.lang, confidence: Math.round(guess.confidence * 100) / 100 } : undefined;

  // Mobile usability: scan inline styles for fixed widths > 400px and small fonts < 12px
  let fixedWidthElements = 0;
  let smallFontElements = 0;
  const styledEls = root.querySelectorAll('[style]');
  for (const el of styledEls) {
    const style = el.getAttribute('style') || '';
    // Fixed pixel width on non-image/non-inline elements
    const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*(\d+)\s*px/i);
    if (widthMatch) {
      const px = parseInt(widthMatch[1], 10);
      if (px > 400 && !style.includes('max-width')) fixedWidthElements++;
    }
    // Small font-size (< 12px)
    const fontMatch = style.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
    if (fontMatch) {
      const px = parseFloat(fontMatch[1]);
      if (px < 12) smallFontElements++;
    }
  }

  // Images with hardcoded width > 500 and no loading attribute or srcset
  const bigImages = images.filter(img => {
    const w = parseInt(img.getAttribute('width') || '0', 10);
    const hasSrcset = !!img.getAttribute('srcset');
    const style = img.getAttribute('style') || '';
    return w > 500 && !hasSrcset && !style.includes('max-width');
  }).length;
  fixedWidthElements += bigImages;

  // Legacy plugins (Flash etc.)
  const legacyPlugins =
    root.querySelectorAll('object[type*="flash"], embed[type*="flash"], embed[src*=".swf"]').length;

  // Render-blocking scripts in head
  const head = root.querySelector('head');
  const headScripts = head ? head.querySelectorAll('script[src]') : [];
  const renderBlockingScripts = headScripts.filter(s => isRenderBlockingScript(s)).length;

  // Check 3 — Font loading
  const fontPreloads = root.querySelectorAll('link[rel="preload"][as="font"]').length;
  const inlineStyleTags = root.querySelectorAll('style');
  let hasFontDisplaySwap = false;
  for (const s of inlineStyleTags) {
    if (/font-display\s*:\s*swap/i.test(s.text)) {
      hasFontDisplaySwap = true;
      break;
    }
  }
  // External font stylesheets (Google Fonts, Adobe Fonts etc.) count as external fonts
  const stylesheetLinks = root.querySelectorAll('link[rel="stylesheet"]');
  const hasExternalFonts = stylesheetLinks.some(l => {
    const href = l.getAttribute('href') || '';
    return /(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|use\.fontawesome\.com)/i.test(href);
  });

  // Check 4 — Third-party scripts
  const allScripts = root.querySelectorAll('script[src]');
  const thirdPartyScripts: { domain: string; category: string; isRenderBlocking: boolean }[] = [];
  const seenDomains = new Set<string>();
  for (const s of allScripts) {
    const src = s.getAttribute('src') || '';
    // `//host/x.js` is another host (protocol-relative), not a path of this site
    if (!src || (src.startsWith('/') && !src.startsWith('//')) || src.startsWith('./') || src.startsWith('#')) continue;
    let host: string;
    let path = '';
    try {
      const u = new URL(src, page.url);
      host = u.hostname;
      path = u.pathname;
    } catch {
      continue;
    }
    if (!host || host === pageHost) continue;
    const category = categorizeScriptDomain(host, path);
    if (category === null) continue;
    const isRenderBlocking = isRenderBlockingScript(s);
    if (!seenDomains.has(host)) {
      seenDomains.add(host);
      thirdPartyScripts.push({ domain: host, category, isRenderBlocking });
    } else if (isRenderBlocking) {
      // Upgrade an existing entry to render-blocking if any instance blocks
      const existing = thirdPartyScripts.find(e => e.domain === host);
      if (existing) existing.isRenderBlocking = true;
    }
  }

  // Check 5 — Favicon / touch icons / manifest / theme color
  const hasFavicon = !!(
    root.querySelector('link[rel="icon"]') ||
    root.querySelector('link[rel="shortcut icon"]')
  );
  const hasAppleTouchIcon = !!root.querySelector('link[rel="apple-touch-icon"]');
  const hasWebManifest = !!root.querySelector('link[rel="manifest"]');
  const hasThemeColor = !!root.querySelector('meta[name="theme-color"]');

  // Client-side rendering detection — same heuristic AutoRenderer uses
  // to decide whether to escalate a page to JS render. Pulled into a
  // shared helper so the rule lives in one place.
  const csr = detectCsrFromRoot(root, wordCount);
  const likelyClientRendered = csr.likelyClientRendered;
  const clientRenderSignal = csr.signal;

  return {
    url: page.url,
    title,
    titleLength: title ? title.length : undefined,
    titlePixelWidth: title ? measurePixelWidth(title) : undefined,
    metaDescription: metaDesc,
    metaDescriptionLength: metaDesc ? metaDesc.length : undefined,
    metaDescriptionPixelWidth: metaDesc ? measurePixelWidth(metaDesc) : undefined,
    h1s,
    h2s,
    h3s,
    canonicalUrl: canonical,
    ogTitle,
    ogDescription: ogDesc,
    ogImage,
    ogImageWidth: ogImageWidth !== undefined && !Number.isNaN(ogImageWidth) ? ogImageWidth : undefined,
    ogImageHeight: ogImageHeight !== undefined && !Number.isNaN(ogImageHeight) ? ogImageHeight : undefined,
    ogImageType,
    ogLocale,
    twitterCard,
    twitterTitle,
    twitterDescription,
    twitterImage,
    lang,
    hasViewport,
    hasCharset,
    schemaTypes,
    schemas,
    schemaParseErrors,
    depth: page.depth,
    redirectChain: page.redirectChain,
    finalUrl: page.finalUrl,
    imagesMissingAlt,
    totalImages: images.length,
    internalLinks,
    externalLinks,
    wordCount,
    hasCanonical: !!canonical,
    renderBlockingScripts,
    modernImageFormats,
    lazyLoadedImages,
    hreflangs,
    viewportBlocksZoom,
    viewportHasInitialScale,
    fixedWidthElements,
    smallFontElements,
    legacyPlugins,
    likelyClientRendered,
    clientRenderSignal,
    bodyTextSample,
    genericAnchors,
    emptyAnchors,
    hasNoindex,
    imageDetails,
    fontPreloads,
    hasFontDisplaySwap,
    hasExternalFonts,
    thirdPartyScripts,
    // ultimate-41 (point 17): inline tracking snippets, and the cookies the server set (names only)
    inlineTrackers: inlineTrackersIn(root.querySelectorAll('script').filter(sc => !sc.hasAttribute('src')).map(sc => sc.text)),
    ...(page.setCookieCount !== undefined ? { setCookieCount: page.setCookieCount, setCookieNames: page.setCookieNames ?? [] } : {}),
    hasFavicon,
    hasAppleTouchIcon,
    hasWebManifest,
    hasThemeColor,
    httpStatus: page.httpStatus,
    protocol: page.protocol,
    headingStructure,
    hasPaginationLinks,
    paginationUrls,
    hasAuthorSignal,
    hasDateSignal,
    externalLinksDetailed,
    xRobotsTag: page.xRobotsTag,
    xRobotsNoindex,
    xRobotsBotSpecific,
    hasJsonLd,
    hasMicrodata: pageHasMicrodata,
    hasRdfa: pageHasRdfa,
    bodyTextHash,
    bodyMinhash,
    textHtmlRatio,
    readabilityScore,
    readabilityLang,
    ...(detectedLang ? { detectedLang } : {}),
    smallTouchTargetCount: countSmallTouchTargets(root),
    renderMode: page.renderMode,
    staticWordCount: page.staticWordCount,
    consoleErrors: page.consoleErrors,
    failedRequests: page.failedRequests,
    axeViolations: page.axeViolations,
    renderTimeMs: page.renderTimeMs,
    staticVsRenderedDiff: page.staticVsRenderedDiff,
    httpErrors: page.httpErrors,
  };
}
