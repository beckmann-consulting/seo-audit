import { parse } from 'node-html-parser';
import type { PageData, PageSEOData } from '@/types';

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

  // OG tags
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
  const ogDesc = root.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim();
  const ogImage = root.querySelector('meta[property="og:image"]')?.getAttribute('content')?.trim();

  // Twitter card
  const twitterCard = root.querySelector('meta[name="twitter:card"]')?.getAttribute('content')?.trim();

  // HTML lang
  const lang = root.querySelector('html')?.getAttribute('lang')?.trim();

  // Viewport
  const viewportContent = root.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
  const hasViewport = viewportContent.includes('width=device-width');

  // Charset
  const hasCharset = !!root.querySelector('meta[charset]');

  // Schema.org
  const schemaScripts = root.querySelectorAll('script[type="application/ld+json"]');
  const schemaTypes: string[] = [];
  schemaScripts.forEach(s => {
    try {
      const json = JSON.parse(s.text);
      if (json['@type']) schemaTypes.push(json['@type']);
      if (Array.isArray(json['@graph'])) {
        json['@graph'].forEach((item: { '@type'?: string }) => {
          if (item['@type']) schemaTypes.push(item['@type']);
        });
      }
    } catch {}
  });

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

  // Links
  const allLinks = root.querySelectorAll('a[href]');
  const pageHost = (() => { try { return new URL(page.url).hostname; } catch { return ''; } })();
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  allLinks.forEach(a => {
    const href = a.getAttribute('href') || '';
    try {
      const u = new URL(href, page.url);
      if (u.hostname === pageHost) internalLinks.push(u.href);
      else if (href.startsWith('http')) externalLinks.push(u.href);
    } catch {}
  });

  // Word count
  const body = root.querySelector('body');
  const bodyText = body ? body.text.replace(/\s+/g, ' ').trim() : '';
  const wordCount = bodyText.split(' ').filter(w => w.length > 2).length;

  // Render-blocking scripts in head
  const head = root.querySelector('head');
  const headScripts = head ? head.querySelectorAll('script[src]') : [];
  const renderBlockingScripts = headScripts.filter(
    s => !s.getAttribute('async') && !s.getAttribute('defer')
  ).length;

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
    twitterCard,
    lang,
    hasViewport,
    hasCharset,
    schemaTypes,
    imagesMissingAlt,
    totalImages: images.length,
    internalLinks,
    externalLinks,
    wordCount,
    hasCanonical: !!canonical,
    renderBlockingScripts,
    modernImageFormats,
    lazyLoadedImages,
  };
}
