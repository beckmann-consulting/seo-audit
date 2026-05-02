// Deep-mode image-format check: per legacy raster URL, HEAD-probe the
// hypothetical .webp + .avif sibling and report whether either exists.
//
// Only runs when the user opts in via `config.deepImageFormatCheck`.
// Capped at MAX_DEEP_IMAGE_PROBES unique source images so a 1000-image
// site doesn't fire 2000 HEAD requests; we'd rather be approximate
// than slow. Per-request 3s timeout.

import type { PageSEOData } from '@/types';
import { classifyImageFormat, isLegacyRasterFormat, type ImageFormat } from './util/image-format';

export interface DeepImageFormatResult {
  url: string;
  format: ImageFormat;
  hasWebpVariant: boolean;
  hasAvifVariant: boolean;
}

const HEAD_TIMEOUT_MS = 3000;
export const MAX_DEEP_IMAGE_PROBES = 30;

function buildHeadHeaders(
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): HeadersInit | undefined {
  if (!userAgent && !authHeader && !customHeaders) return undefined;
  const h: Record<string, string> = {};
  if (userAgent) h['User-Agent'] = userAgent;
  if (authHeader) h['Authorization'] = authHeader;
  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) h[name] = value;
  }
  return h;
}

async function headOk(url: string, headers?: HeadersInit): Promise<boolean> {
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function legacyVariantCandidates(srcAbs: string): { webp: string; avif: string } {
  return {
    webp: srcAbs.replace(/\.(jpe?g|png)(\?|#|$)/i, '.webp$2'),
    avif: srcAbs.replace(/\.(jpe?g|png)(\?|#|$)/i, '.avif$2'),
  };
}

function collectLegacyCandidates(pages: PageSEOData[]): string[] {
  const seen = new Set<string>();
  for (const page of pages) {
    for (const img of page.imageDetails) {
      const raw = img.src;
      if (!raw || raw.startsWith('data:')) continue;
      try {
        const abs = new URL(raw, page.url);
        if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
        const fmt = classifyImageFormat(abs.href);
        if (!isLegacyRasterFormat(fmt)) continue;
        seen.add(abs.href);
      } catch {
        // skip malformed
      }
    }
  }
  return [...seen];
}

export async function checkDeepImageFormats(
  pages: PageSEOData[],
  userAgent?: string,
  authHeader?: string,
  customHeaders?: Record<string, string>,
): Promise<DeepImageFormatResult[]> {
  if (pages.length === 0) return [];
  const candidates = collectLegacyCandidates(pages).slice(0, MAX_DEEP_IMAGE_PROBES);
  if (candidates.length === 0) return [];

  const headers = buildHeadHeaders(userAgent, authHeader, customHeaders);

  return Promise.all(candidates.map(async (url): Promise<DeepImageFormatResult> => {
    const variants = legacyVariantCandidates(url);
    const [webpOk, avifOk] = await Promise.all([
      headOk(variants.webp, headers),
      headOk(variants.avif, headers),
    ]);
    return {
      url,
      format: classifyImageFormat(url),
      hasWebpVariant: webpOk,
      hasAvifVariant: avifOk,
    };
  }));
}
