// CSV export of selected AuditResult tables.
//
// Six tables are exposed to the UI; the spec asked for at least five.
// We follow RFC 4180 for escaping (double-quote wrap when the field
// contains a comma, double-quote, or newline; double an inner quote)
// and prefix the output with a UTF-8 BOM so Excel detects the
// encoding without prompting.
//
// All tables produce a header row even when empty — keeps automation
// scripts simple (no special-casing for empty exports).

import type { AuditResult, Lang } from '@/types';

export type CsvTable =
  | 'findings'
  | 'pages'
  | 'broken-links'
  | 'error-pages'
  | 'sitemap-urls'
  | 'redirects';

export const CSV_TABLES: CsvTable[] = [
  'findings',
  'pages',
  'broken-links',
  'error-pages',
  'sitemap-urls',
  'redirects',
];

const UTF8_BOM = '﻿';

// ============================================================
//  RFC 4180 escaping
// ============================================================

const NEEDS_ESCAPE = /[",\r\n]/;

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (!NEEDS_ESCAPE.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

function rowsToCsv(headers: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const headerLine = headers.map(escapeField).join(',');
  const lines = [headerLine];
  for (const row of rows) {
    lines.push(row.map(escapeField).join(','));
  }
  // Excel-friendly CRLF line endings + BOM.
  return UTF8_BOM + lines.join('\r\n') + '\r\n';
}

// ============================================================
//  Per-table builders
// ============================================================

function buildFindingsCsv(result: AuditResult, lang: Lang): string {
  const headers = [
    'id', 'priority', 'module', 'effort', 'impact',
    'title', 'description', 'recommendation', 'affected_url',
  ];
  const rows = result.findings.map(f => [
    f.id, f.priority, f.module, f.effort, f.impact,
    lang === 'de' ? f.title_de : f.title_en,
    lang === 'de' ? f.description_de : f.description_en,
    lang === 'de' ? f.recommendation_de : f.recommendation_en,
    f.affectedUrl ?? '',
  ]);
  return rowsToCsv(headers, rows);
}

function buildPagesCsv(result: AuditResult): string {
  const headers = [
    'url', 'depth', 'http_status', 'lang',
    'title', 'title_chars', 'title_pixel_width',
    'meta_description_chars', 'meta_description_pixel_width',
    'h1_count', 'h2_count', 'word_count',
    'has_canonical', 'has_noindex',
    'images_total', 'images_missing_alt',
    'internal_links', 'external_links',
    'text_html_ratio', 'readability_score', 'readability_lang',
    'has_jsonld', 'has_microdata', 'has_rdfa',
  ];
  const rows = result.pages.map(p => [
    p.url, p.depth, p.httpStatus, p.lang ?? '',
    p.title ?? '', p.titleLength ?? '', p.titlePixelWidth ?? '',
    p.metaDescriptionLength ?? '', p.metaDescriptionPixelWidth ?? '',
    p.h1s.length, p.h2s.length, p.wordCount,
    p.hasCanonical, p.hasNoindex,
    p.totalImages, p.imagesMissingAlt,
    p.internalLinks.length, p.externalLinks.length,
    p.textHtmlRatio.toFixed(4),
    p.readabilityScore ?? '', p.readabilityLang ?? '',
    p.hasJsonLd, p.hasMicrodata, p.hasRdfa,
  ]);
  return rowsToCsv(headers, rows);
}

function buildBrokenLinksCsv(result: AuditResult): string {
  const headers = ['url'];
  const rows = result.crawlStats.brokenLinks.map(u => [u]);
  return rowsToCsv(headers, rows);
}

function buildErrorPagesCsv(result: AuditResult): string {
  const headers = ['url', 'status'];
  const rows = result.crawlStats.errorPages.map(e => [e.url, e.status]);
  return rowsToCsv(headers, rows);
}

function buildSitemapUrlsCsv(result: AuditResult): string {
  const headers = ['url', 'lastmod', 'changefreq', 'priority', 'image_count'];
  const entries = result.sitemapInfo?.urls ?? [];
  const rows = entries.map(e => [
    e.url, e.lastmod ?? '', e.changefreq ?? '', e.priority ?? '', e.imageCount,
  ]);
  return rowsToCsv(headers, rows);
}

function buildRedirectsCsv(result: AuditResult): string {
  const headers = ['from', 'chain', 'final_url', 'hops'];
  // Pages that went through any redirect (chain length ≥ 1).
  const rows = result.pages
    .filter(p => p.redirectChain.length > 0)
    .map(p => [
      p.redirectChain[0],
      p.redirectChain.join(' → '),
      p.finalUrl,
      p.redirectChain.length,
    ]);
  return rowsToCsv(headers, rows);
}

// ============================================================
//  Dispatch + filename helper
// ============================================================

export function buildCsvExport(result: AuditResult, table: CsvTable, lang: Lang = 'en'): string {
  switch (table) {
    case 'findings':     return buildFindingsCsv(result, lang);
    case 'pages':        return buildPagesCsv(result);
    case 'broken-links': return buildBrokenLinksCsv(result);
    case 'error-pages':  return buildErrorPagesCsv(result);
    case 'sitemap-urls': return buildSitemapUrlsCsv(result);
    case 'redirects':    return buildRedirectsCsv(result);
  }
}

export function csvFilename(result: AuditResult, table: CsvTable): string {
  const date = new Date(result.auditedAt).toISOString().slice(0, 10);
  return `${result.domain}-${table}-${date}.csv`;
}
