// Test fixtures for the AI visibility module: a PageSEOData with sane
// defaults (the same shape seo-xrobots.test.ts builds) and HTML builders.

import type { PageSEOData, ParsedSchema } from '@/types';

export function seoPage(partial: Partial<PageSEOData> = {}): PageSEOData {
  const url = partial.url ?? 'https://example.com/';
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    hasJsonLd: false, hasMicrodata: false, hasRdfa: false,
    bodyTextHash: '', bodyMinhash: [], textHtmlRatio: 0.3, smallTouchTargetCount: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: 600, hasCanonical: true,
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
    ...partial,
  } as PageSEOData;
}

export function schema(type: string, data: Record<string, unknown>): ParsedSchema {
  return { type, data: { '@type': type, ...data } };
}

export const words = (n: number, w = 'inhalt') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

export function html(body: string, head = ''): string {
  return `<!doctype html><html lang="de"><head>${head}</head><body>${body}</body></html>`;
}
