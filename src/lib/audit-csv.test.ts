import { describe, it, expect } from 'vitest';
import { buildCsvExport, csvFilename, CSV_TABLES } from './audit-csv';
import type { AuditResult, Finding, PageSEOData } from '@/types';

const UTF8_BOM = '﻿';

function makeFinding(o: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    priority: 'important',
    module: 'seo',
    effort: 'low',
    impact: 'medium',
    title_de: 'DE Titel',
    title_en: 'EN Title',
    description_de: 'DE Beschreibung',
    description_en: 'EN Description',
    recommendation_de: 'DE Empfehlung',
    recommendation_en: 'EN Recommendation',
    ...o,
  };
}

function makePage(o: Partial<PageSEOData> = {}): PageSEOData {
  return {
    url: 'https://example.com/',
    h1s: ['Hello'], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: o.url ?? 'https://example.com/',
    imagesMissingAlt: 0, totalImages: 5,
    internalLinks: [], externalLinks: [],
    wordCount: 500, hasCanonical: true,
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
    bodyTextHash: '', bodyMinhash: [], textHtmlRatio: 0.18,
    ...o,
  };
}

function makeResult(o: Partial<AuditResult> = {}): AuditResult {
  return {
    config: { url: 'https://example.com/', modules: [], author: 't', maxPages: 0 },
    auditedAt: '2026-04-27T10:00:00.000Z',
    domain: 'example.com',
    totalScore: 75,
    moduleScores: [],
    findings: [],
    strengths_de: [], strengths_en: [],
    crawlStats: { totalPages: 0, crawledPages: 0, brokenLinks: [], redirectChains: [], externalLinks: 0, errorPages: [] },
    pages: [],
    topFindings: [],
    claudePrompt: '',
    summary_de: '', summary_en: '',
    ...o,
  };
}

describe('CSV escaping', () => {
  it('starts every CSV with the UTF-8 BOM (Excel encoding hint)', () => {
    for (const table of CSV_TABLES) {
      const csv = buildCsvExport(makeResult(), table);
      expect(csv.startsWith(UTF8_BOM)).toBe(true);
    }
  });

  it('quotes fields that contain commas', () => {
    const result = makeResult({
      findings: [makeFinding({ title_en: 'Hello, World' })],
    });
    const csv = buildCsvExport(result, 'findings');
    expect(csv).toContain('"Hello, World"');
  });

  it('doubles inner double quotes inside a quoted field', () => {
    const result = makeResult({
      findings: [makeFinding({ title_en: 'A "quoted" word' })],
    });
    const csv = buildCsvExport(result, 'findings');
    expect(csv).toContain('"A ""quoted"" word"');
  });

  it('quotes fields containing newlines so the row stays intact', () => {
    const result = makeResult({
      findings: [makeFinding({ description_en: 'line one\nline two' })],
    });
    const csv = buildCsvExport(result, 'findings');
    expect(csv).toContain('"line one\nline two"');
  });

  it('uses CRLF line endings', () => {
    const csv = buildCsvExport(makeResult(), 'findings');
    expect(csv).toContain('\r\n');
  });

  it('emits header-only CSVs for empty inputs (no errors)', () => {
    for (const table of CSV_TABLES) {
      const csv = buildCsvExport(makeResult(), table);
      // Strip BOM, then count lines: 1 header + trailing CRLF → 2 entries when split on \r\n
      const lines = csv.replace(UTF8_BOM, '').split('\r\n').filter(Boolean);
      expect(lines.length).toBe(1);
    }
  });
});

describe('Per-table content', () => {
  it('findings: header row + one row per finding, picks DE/EN by lang', () => {
    const result = makeResult({
      findings: [
        makeFinding({ id: 'f1', title_de: 'DE 1', title_en: 'EN 1' }),
        makeFinding({ id: 'f2', title_de: 'DE 2', title_en: 'EN 2' }),
      ],
    });
    const en = buildCsvExport(result, 'findings', 'en');
    expect(en).toContain('id,priority,module');
    expect(en).toContain('f1,important,seo');
    expect(en).toContain('EN 1');
    expect(en).not.toContain('DE 1');

    const de = buildCsvExport(result, 'findings', 'de');
    expect(de).toContain('DE 1');
    expect(de).not.toContain('EN 1');
  });

  it('pages: includes all numeric/text columns we surface in the UI', () => {
    const result = makeResult({
      pages: [makePage({
        url: 'https://example.com/x',
        title: 'Test',
        titleLength: 4,
        titlePixelWidth: 32,
      })],
    });
    const csv = buildCsvExport(result, 'pages');
    expect(csv).toContain('url,depth,http_status');
    expect(csv).toContain('text_html_ratio');
    expect(csv).toContain('https://example.com/x');
    expect(csv).toContain(',Test,4,32,');
  });

  it('broken-links: one row per URL', () => {
    const result = makeResult({
      crawlStats: { totalPages: 0, crawledPages: 0, brokenLinks: ['https://x.com/a', 'https://x.com/b'], redirectChains: [], externalLinks: 0, errorPages: [] },
    });
    const csv = buildCsvExport(result, 'broken-links');
    const lines = csv.replace(UTF8_BOM, '').split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('error-pages: url + status', () => {
    const result = makeResult({
      crawlStats: { totalPages: 0, crawledPages: 0, brokenLinks: [], redirectChains: [], externalLinks: 0, errorPages: [{ url: 'https://x.com/a', status: 404 }] },
    });
    const csv = buildCsvExport(result, 'error-pages');
    expect(csv).toContain('url,status');
    expect(csv).toContain('https://x.com/a,404');
  });

  it('sitemap-urls: serialises lastmod / changefreq / priority / image_count', () => {
    const result = makeResult({
      sitemapInfo: {
        urls: [{
          url: 'https://x.com/p',
          lastmod: '2024-01-01',
          changefreq: 'weekly',
          priority: 0.8,
          imageCount: 3,
        }],
        sitemapUrl: 'https://x.com/sitemap.xml',
        isIndex: false,
        subSitemaps: [],
      },
    });
    const csv = buildCsvExport(result, 'sitemap-urls');
    expect(csv).toContain('url,lastmod,changefreq,priority,image_count');
    expect(csv).toContain('https://x.com/p,2024-01-01,weekly,0.8,3');
  });

  it('redirects: only pages with non-empty redirect chains', () => {
    const result = makeResult({
      pages: [
        makePage({ url: 'https://x.com/a', redirectChain: [] }),
        makePage({
          url: 'https://x.com/b-final',
          finalUrl: 'https://x.com/b-final',
          redirectChain: ['https://x.com/b', 'https://x.com/b-stage'],
        }),
      ],
    });
    const csv = buildCsvExport(result, 'redirects');
    const lines = csv.replace(UTF8_BOM, '').split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(2); // header + 1 redirected page
    expect(csv).toContain('https://x.com/b');
    expect(csv).toContain('2'); // hops
  });
});

describe('csvFilename', () => {
  it('includes domain, table, and audit date', () => {
    const result = makeResult({ domain: 'example.com', auditedAt: '2026-04-27T10:00:00.000Z' });
    expect(csvFilename(result, 'findings')).toBe('example.com-findings-2026-04-27.csv');
    expect(csvFilename(result, 'sitemap-urls')).toBe('example.com-sitemap-urls-2026-04-27.csv');
  });
});

describe('CSV_TABLES coverage', () => {
  it('exposes at least 5 tables (spec requirement)', () => {
    expect(CSV_TABLES.length).toBeGreaterThanOrEqual(5);
  });
});
