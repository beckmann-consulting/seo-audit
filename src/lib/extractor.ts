import { parse } from 'node-html-parser';
import type { PageData, PageSEOData, ParsedSchema } from '@/types';

// Generic anchor text blacklist (DE + EN). Normalised to lowercase, trimmed.
const GENERIC_ANCHOR_TEXTS = new Set([
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

  // Headings
  const h1s = root.querySelectorAll('h1').map(h => h.text.trim()).filter(Boolean);
  const h2s = root.querySelectorAll('h2').map(h => h.text.trim()).filter(Boolean);
  const h3s = root.querySelectorAll('h3').map(h => h.text.trim()).filter(Boolean);

  // Canonical
  const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim();

  // Hreflang (link[rel="alternate"][hreflang])
  const hreflangEls = root.querySelectorAll('link[rel="alternate"][hreflang]');
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
  const hasNoindex = /\bnoindex\b/i.test(robotsMeta) || /\bnoindex\b/i.test(googlebotMeta);

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

  // Schema.org
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
  const schemaTypes: string[] = schemas.map(s => s.type);

  // Images
  const images = root.querySelectorAll('img');
  const imagesMissingAlt = images.filter(img => {
    const alt = img.getAttribute('alt');
    return alt === null || alt === undefined;
  }).length;
  const modernImageFormats = images.filter(img => {
    const src = img.getAttribute('src') || '';
    return /\.(webp|avif)(\?|$)/i.test(src);
  }).length;
  const lazyLoadedImages = images.filter(img => img.getAttribute('loading') === 'lazy').length;

  // Links + anchor text analysis
  const allLinks = root.querySelectorAll('a[href]');
  const pageHost = (() => { try { return new URL(page.url).hostname; } catch { return ''; } })();
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
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

  // Word count + sample for downstream content analysis
  const body = root.querySelector('body');
  const bodyText = body ? body.text.replace(/\s+/g, ' ').trim() : '';
  const wordCount = bodyText.split(' ').filter(w => w.length > 2).length;
  const bodyTextSample = bodyText.slice(0, 2000);

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
  const renderBlockingScripts = headScripts.filter(
    s => !s.getAttribute('async') && !s.getAttribute('defer')
  ).length;

  // Client-side rendering detection
  // SPAs usually ship an HTML shell with an empty root element that gets
  // filled in by JS at runtime. Crawlers without JS execution (AI retrieval
  // bots, social preview fetchers, old search engines) won't see anything.
  let likelyClientRendered = false;
  let clientRenderSignal: string | undefined;

  const spaRoots: { selector: string; name: string }[] = [
    { selector: '#root', name: 'React #root' },
    { selector: '#app', name: 'Vue/generic #app' },
    { selector: '#__next', name: 'Next.js #__next' },
    { selector: '#___gatsby', name: 'Gatsby #___gatsby' },
    { selector: '#__nuxt', name: 'Nuxt #__nuxt' },
    { selector: '[data-reactroot]', name: 'React data-reactroot' },
  ];
  for (const { selector, name } of spaRoots) {
    const el = root.querySelector(selector);
    if (el) {
      const innerText = el.text.replace(/\s+/g, ' ').trim();
      if (innerText.length < 100) {
        likelyClientRendered = true;
        clientRenderSignal = `${name} is empty (${innerText.length} chars)`;
        break;
      }
    }
  }

  // Fallback heuristic: body has almost no text but there is a <noscript> fallback
  if (!likelyClientRendered && wordCount < 30) {
    const noscript = root.querySelector('noscript');
    if (noscript && noscript.text.trim().length > 50) {
      likelyClientRendered = true;
      clientRenderSignal = `body has ${wordCount} words but <noscript> contains content`;
    }
  }

  return {
    url: page.url,
    title,
    titleLength: title ? title.length : undefined,
    metaDescription: metaDesc,
    metaDescriptionLength: metaDesc ? metaDesc.length : undefined,
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
  };
}
