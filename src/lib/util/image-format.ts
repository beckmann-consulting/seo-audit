// Lightweight image-format classifier driven by URL suffix.
//
// We don't follow the URL — that would require a HEAD request — and
// rely on file extension heuristics. Robust enough for the audit's
// adoption-ratio pass; for per-image deep checks we still HEAD the
// hypothetical .webp/.avif sibling.

export type ImageFormat = 'avif' | 'webp' | 'jpg' | 'png' | 'gif' | 'svg' | 'other';

const SUFFIX_MAP: Array<[string, ImageFormat]> = [
  ['.avif', 'avif'],
  ['.webp', 'webp'],
  ['.jpeg', 'jpg'],
  ['.jpg', 'jpg'],
  ['.png', 'png'],
  ['.gif', 'gif'],
  ['.svg', 'svg'],
];

export function classifyImageFormat(url: string): ImageFormat {
  if (!url) return 'other';
  // Strip query + fragment — common on cache-busted CDNs
  const clean = url.split('?')[0].split('#')[0];
  const lower = clean.toLowerCase();
  for (const [suffix, fmt] of SUFFIX_MAP) {
    if (lower.endsWith(suffix)) return fmt;
  }
  return 'other';
}

export function isModernFormat(format: ImageFormat): boolean {
  return format === 'avif' || format === 'webp';
}

export function isLegacyRasterFormat(format: ImageFormat): boolean {
  return format === 'jpg' || format === 'png';
}
