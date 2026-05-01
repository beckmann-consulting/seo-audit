// Findings driven by Google Search Console data (Phase G1c).
//
// All GSC findings live here so the "is GSC actually available?"
// guard is centralised — `if (gscResult.state !== 'ok') return []`.
// Future findings/ga4.ts and findings/bing.ts will follow the same
// shape so each external-data integration stays self-contained.
//
// Module assignment is still 'seo' for downstream scoring (GSC
// findings ARE SEO findings semantically — file location is just
// organisational).

import type {
  Finding,
  GscResult,
  GscRow,
  PageSEOData,
  SitemapInfo,
} from '@/types';
import { id } from './utils';
import { normaliseUrl } from '../util/url-normalize';

// Pages with a sitemap lastmod newer than this many days are
// excluded from the indexing-issues analysis: they may simply not
// have been crawled by Google yet.
const RECENT_PAGE_DAYS = 30;

// gsc-indexing-issues thresholds.
const INDEXING_ISSUE_RATIO_THRESHOLD = 0.5;   // > 50% of eligible pages
const INDEXING_ISSUE_MIN_ELIGIBLE = 5;         // tiny sites: trust the user

// low-ctr-high-impressions thresholds.
const LOW_CTR_MIN_IMPRESSIONS = 100;
const LOW_CTR_THRESHOLD = 0.02;                // 2%
const LOW_CTR_MAX_POSITION = 10;               // Page-1 only — Position-CTR-Korrelation

function buildRecentUrlSet(sitemap?: SitemapInfo): Set<string> {
  const out = new Set<string>();
  if (!sitemap?.urls) return out;
  const cutoff = Date.now() - RECENT_PAGE_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of sitemap.urls) {
    if (!entry.lastmod) continue;
    const ts = Date.parse(entry.lastmod);
    if (Number.isNaN(ts)) continue;
    if (ts > cutoff) out.add(normaliseUrl(entry.url));
  }
  return out;
}

function buildPageImpressionSet(rows: GscRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    const url = row.keys?.[0];
    if (url) out.add(normaliseUrl(url));
  }
  return out;
}

export function generateGscFindings(
  pages: PageSEOData[],
  gscResult: GscResult | undefined,
  sitemap?: SitemapInfo,
): Finding[] {
  // Guard: only run when GSC data is actually available.
  if (!gscResult || gscResult.state !== 'ok') return [];
  if (pages.length === 0) return [];

  const findings: Finding[] = [];
  const { topPages } = gscResult.data;
  const recentUrls = buildRecentUrlSet(sitemap);
  const pagesWithImpressions = buildPageImpressionSet(topPages);

  // ============================================================
  //  gsc-indexing-issues  (Recommended)
  // ============================================================
  // Heuristic: pages crawled by us but never received an impression
  // in the 28-day window. Excludes pages with a sitemap lastmod
  // newer than 30 days — those may simply not be indexed yet.
  //
  // The wording deliberately says "without impressions in 28 days",
  // NOT "not indexed" — the URL Inspection API would be needed for
  // a direct index-status check (deferred to a later ticket due to
  // its quota cost).
  const eligible = pages.filter(p => !recentUrls.has(normaliseUrl(p.url)));
  const withoutImpressions = eligible.filter(
    p => !pagesWithImpressions.has(normaliseUrl(p.url)),
  );

  if (
    eligible.length >= INDEXING_ISSUE_MIN_ELIGIBLE &&
    withoutImpressions.length / eligible.length > INDEXING_ISSUE_RATIO_THRESHOLD
  ) {
    const ratio = Math.round((withoutImpressions.length / eligible.length) * 100);
    const sample = withoutImpressions.slice(0, 5).map(p => p.url).join(', ');
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'high', impact: 'medium',
      title_de: `${withoutImpressions.length} von ${eligible.length} Seiten ohne Impressions in 28 Tagen (${ratio}%)`,
      title_en: `${withoutImpressions.length} of ${eligible.length} pages without impressions in 28 days (${ratio}%)`,
      description_de: `Diese Seiten sind im Crawl gefunden worden, hatten aber im 28-Tage-Fenster (${gscResult.data.startDate} bis ${gscResult.data.endDate}) keine Impressions in der Search Console — Hinweis auf nicht indexiert ODER nicht für Suchanfragen relevant. Seiten mit Sitemap-lastmod < 30 Tagen sind ausgeschlossen (möglicherweise einfach noch nicht von Google gecrawlt). Beispiele: ${sample}`,
      description_en: `These pages are reachable via crawling but received zero impressions in the 28-day window (${gscResult.data.startDate} to ${gscResult.data.endDate}) — a signal that they're either not indexed OR not surfaced for any user queries. Pages with a sitemap lastmod < 30 days are excluded (Google may simply not have crawled them yet). Examples: ${sample}`,
      recommendation_de: 'Per Hand stichprobenartig in Search Console → URL-Prüfung kontrollieren: indexiert oder nicht? Falls nicht indexiert: Canonical-Tag, robots.txt, Meta-noindex prüfen. Falls indexiert ohne Impressions: Content für realistische Suchintention überarbeiten oder Page-Strategie hinterfragen (interne Verlinkung, Keyword-Targeting).',
      recommendation_en: 'Spot-check a few in Search Console → URL Inspection: indexed or not? If not indexed: review canonical tag, robots.txt, meta noindex. If indexed but no impressions: rework content for realistic search intent or revisit the page strategy (internal linking, keyword targeting).',
      affectedUrl: withoutImpressions[0].url,
    });
  }

  // ============================================================
  //  low-ctr-high-impressions  (Optional)
  // ============================================================
  // Pages with high impressions on page-1 but low CTR have a
  // title/snippet problem — high relevance signal from Google but
  // users don't click. Capping at position <= 10 avoids flagging
  // page-2 results where 1-2% CTR is normal expected behaviour.
  const lowCtrPages = topPages.filter(row =>
    row.impressions > LOW_CTR_MIN_IMPRESSIONS &&
    row.ctr < LOW_CTR_THRESHOLD &&
    row.position <= LOW_CTR_MAX_POSITION,
  );

  if (lowCtrPages.length > 0) {
    // Sort worst-first by impressions (these are the highest-leverage
    // optimisations — most user attention, least click-through).
    const sorted = [...lowCtrPages].sort((a, b) => b.impressions - a.impressions);
    const sample = sorted.slice(0, 5).map(row => {
      const url = row.keys?.[0] ?? 'unknown';
      const ctrPct = (row.ctr * 100).toFixed(1);
      return `${url} (${row.impressions} Impressions, ${ctrPct}% CTR, Pos ${row.position.toFixed(1)})`;
    }).join('; ');

    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${lowCtrPages.length} Seite(n) mit niedrigem CTR (<2%) auf Seite 1`,
      title_en: `${lowCtrPages.length} page(s) with low CTR (<2%) on page 1`,
      description_de: `Diese Seiten ranken auf Seite 1 (Position ≤ 10) mit > 100 Impressions in 28 Tagen, aber CTR unter 2%. Hohe Sichtbarkeit, aber Nutzer klicken nicht — typisch für unattraktive Title-Tags oder Meta-Descriptions. Beispiele: ${sample}`,
      description_en: `These pages rank on page 1 (position ≤ 10) with > 100 impressions in 28 days, but CTR under 2%. High visibility, low click-through — typical signature of unappealing title tags or meta descriptions. Examples: ${sample}`,
      recommendation_de: 'Title-Tag und Meta-Description der betroffenen Seiten neu schreiben: konkreter Nutzen-Versprechen, Keyword vorne, Call-to-Action am Ende. Auf SERP-Vorschau im Google Rich Results Test gegenchecken. Bonus: Schema.org-Markup ergänzen (FAQPage, Article, Product) für Rich-Snippets-Boost.',
      recommendation_en: 'Rewrite the title tag and meta description for each affected page: concrete value promise, keyword up front, call-to-action at the end. Verify with the Google Rich Results Test SERP preview. Bonus: add Schema.org markup (FAQPage, Article, Product) for rich-snippet boost.',
      affectedUrl: sorted[0].keys?.[0],
    });
  }

  return findings;
}
