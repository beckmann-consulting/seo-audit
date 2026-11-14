// ultimate-41, point 16: SVG counts as a modern format in the tech finding.
import { describe, it, expect } from 'vitest';
import { generateTechFindings } from './tech';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import type { CrawlStats } from '@/types';

const stats: CrawlStats = { totalPages: 1, crawledPages: 1, brokenLinks: [], redirectChains: [], externalLinks: 0, httpErrors: [], unreachable: [], renderFailed: [] };

describe('tech.modern-image-formats (ultimate-41, point 16)', () => {
  it('no finding when SVG and WebP make up half or more', () => {
    const pages = [seoPage({ totalImages: 10, modernImageFormats: 6 })];
    expect(generateTechFindings(pages, stats, undefined, undefined).find(f => f.code === 'tech.modern-image-formats')).toBeUndefined();
  });

  it('a finding with the code when fewer than half are modern, its title naming SVG', () => {
    const pages = [seoPage({ totalImages: 10, modernImageFormats: 2 })];
    const f = generateTechFindings(pages, stats, undefined, undefined).find(x => x.code === 'tech.modern-image-formats');
    expect(f).toMatchObject({ priority: 'recommended', module: 'tech' });
    expect(f?.title_en).toBe('Only 2 of 10 images in modern formats (WebP/AVIF/SVG)');
  });
});
