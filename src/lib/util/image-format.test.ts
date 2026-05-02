import { describe, it, expect } from 'vitest';
import { classifyImageFormat, isModernFormat, isLegacyRasterFormat } from './image-format';

describe('classifyImageFormat', () => {
  it('classifies common raster + modern formats by suffix', () => {
    expect(classifyImageFormat('https://example.com/x.jpg')).toBe('jpg');
    expect(classifyImageFormat('https://example.com/x.jpeg')).toBe('jpg');
    expect(classifyImageFormat('https://example.com/x.png')).toBe('png');
    expect(classifyImageFormat('https://example.com/x.gif')).toBe('gif');
    expect(classifyImageFormat('https://example.com/x.svg')).toBe('svg');
    expect(classifyImageFormat('https://example.com/x.webp')).toBe('webp');
    expect(classifyImageFormat('https://example.com/x.avif')).toBe('avif');
  });

  it('strips query string before matching suffix', () => {
    expect(classifyImageFormat('https://example.com/x.jpg?v=12345')).toBe('jpg');
    expect(classifyImageFormat('https://cdn.example.com/path/img.webp?w=500&q=80')).toBe('webp');
  });

  it('strips fragment before matching suffix', () => {
    expect(classifyImageFormat('https://example.com/x.png#cache-1')).toBe('png');
  });

  it('handles uppercase + mixed case extensions', () => {
    expect(classifyImageFormat('https://example.com/HERO.JPG')).toBe('jpg');
    expect(classifyImageFormat('https://example.com/Logo.PnG')).toBe('png');
    expect(classifyImageFormat('https://example.com/banner.WebP')).toBe('webp');
  });

  it('handles multi-dot filenames (e.g. min.webp)', () => {
    expect(classifyImageFormat('https://example.com/img.min.webp')).toBe('webp');
    expect(classifyImageFormat('https://example.com/icon.v2.svg')).toBe('svg');
  });

  it('returns "other" for URLs without recognised suffix', () => {
    expect(classifyImageFormat('https://example.com/')).toBe('other');
    expect(classifyImageFormat('https://example.com/img')).toBe('other');
    expect(classifyImageFormat('https://example.com/api/image?id=42')).toBe('other');
  });

  it('returns "other" for empty / nonsense input', () => {
    expect(classifyImageFormat('')).toBe('other');
    expect(classifyImageFormat('not-a-url')).toBe('other');
  });

  it('does NOT match a directory-name that looks like an extension', () => {
    // /images.png/foo has no ".png" at the end of the path
    expect(classifyImageFormat('https://example.com/images.png/foo')).toBe('other');
  });

  it('returns "other" for data: URLs', () => {
    expect(classifyImageFormat('data:image/png;base64,iVBOR')).toBe('other');
  });
});

describe('isModernFormat / isLegacyRasterFormat', () => {
  it('flags webp + avif as modern', () => {
    expect(isModernFormat('webp')).toBe(true);
    expect(isModernFormat('avif')).toBe(true);
    expect(isModernFormat('jpg')).toBe(false);
    expect(isModernFormat('png')).toBe(false);
    expect(isModernFormat('svg')).toBe(false);
  });

  it('flags jpg + png as legacy raster (excludes svg + gif)', () => {
    expect(isLegacyRasterFormat('jpg')).toBe(true);
    expect(isLegacyRasterFormat('png')).toBe(true);
    expect(isLegacyRasterFormat('svg')).toBe(false);
    expect(isLegacyRasterFormat('gif')).toBe(false);
    expect(isLegacyRasterFormat('webp')).toBe(false);
    expect(isLegacyRasterFormat('avif')).toBe(false);
  });
});
