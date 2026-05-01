// Findings driven by Bing Webmaster Tools data (Phase G3c).
//
// All Bing findings live here so the "is Bing actually available?"
// guard is centralised — `if (bingResult.state !== 'ok') return []`.
// Same pattern as findings/gsc.ts; same module assignment ('seo')
// because Bing findings ARE SEO findings semantically.
//
// Two findings:
//   - bing-low-coverage         (Recommended) — large fraction of
//     crawled pages have zero Bing impressions.
//   - bing-low-ctr-high-impressions (Optional) — page-1 queries with
//     high impressions but suspiciously low CTR.

import type {
  Finding,
  BingResult,
  BingRow,
  PageSEOData,
} from '@/types';
import { id } from './utils';
import { normaliseUrl } from '../util/url-normalize';

// bing-low-coverage thresholds. Stricter min-pages floor than GSC's
// (5) — same value, but the rationale is the same: tiny sites shouldn't
// trigger a "your Bing coverage is poor" headline because the sample
// is too small to be meaningful.
const LOW_COVERAGE_RATIO_THRESHOLD = 0.5;
const LOW_COVERAGE_MIN_PAGES = 5;

// bing-low-ctr-high-impressions thresholds. CTR floor is tighter
// than GSC's 2% because Bing's typical CTR distribution sits lower
// — 1.5% is the rough equivalent "this query underperforms" line.
const LOW_CTR_MIN_IMPRESSIONS = 100;
const LOW_CTR_THRESHOLD = 0.015;
const LOW_CTR_MAX_POSITION = 10;

// Sample size for the per-finding detail line. GSC uses 5 for pages;
// Bing uses 3 for queries because query strings are typically longer
// than URLs and crowd the description faster.
const QUERY_SAMPLE_SIZE = 3;
const PAGE_SAMPLE_SIZE = 5;

function buildPageImpressionSet(rows: BingRow[]): Set<string> {
  const out = new Set<string>();
  for (const row of rows) {
    // Bing's row carries the URL on `page` (vs GSC's keys[0]). Filter
    // to rows that actually had impressions — a row with zero
    // impressions wouldn't appear in topPages anyway, but defensive.
    if (row.page && row.impressions > 0) {
      out.add(normaliseUrl(row.page));
    }
  }
  return out;
}

export function generateBingFindings(
  pages: PageSEOData[],
  bingResult: BingResult | undefined,
): Finding[] {
  // Guard: only run when Bing data is actually available.
  if (!bingResult || bingResult.state !== 'ok') return [];
  if (pages.length === 0) return [];

  const findings: Finding[] = [];
  const { topPages, topQueries } = bingResult.data;
  const pagesWithImpressions = buildPageImpressionSet(topPages);

  // ============================================================
  //  bing-low-coverage  (Recommended)
  // ============================================================
  // Heuristic: a substantial fraction of crawled pages have zero Bing
  // impressions. Bing's index is gentler than Google's — many sites
  // ship to Google but skim Bing — so we set the threshold at >50%
  // missing rather than something stricter. No sitemap-recent bypass
  // (unlike GSC) because Bing's discovery pipeline is less time-
  // sensitive: pages either get indexed or they don't.
  const withoutImpressions = pages.filter(
    p => !pagesWithImpressions.has(normaliseUrl(p.url)),
  );

  if (
    pages.length >= LOW_COVERAGE_MIN_PAGES &&
    withoutImpressions.length / pages.length > LOW_COVERAGE_RATIO_THRESHOLD
  ) {
    const ratio = Math.round((withoutImpressions.length / pages.length) * 100);
    const sample = withoutImpressions.slice(0, PAGE_SAMPLE_SIZE).map(p => p.url).join(', ');
    findings.push({
      id: id(), priority: 'recommended', module: 'seo', effort: 'medium', impact: 'medium',
      title_de: `${withoutImpressions.length} von ${pages.length} Seiten ohne Bing-Impressions (${ratio}%)`,
      title_en: `${withoutImpressions.length} of ${pages.length} pages without Bing impressions (${ratio}%)`,
      description_de: `Diese Seiten sind im Crawl gefunden, aber Bing Webmaster Tools meldet keine Impressions — Hinweis auf nicht-indexierte oder kaum sichtbare Pages bei Bing. Bing's Index hat oft Lücken, die Google nicht hat; die typischen Ursachen sind nicht eingereichte Sitemaps, fehlende Bing-Verifikation, oder Pages mit zu wenig Inhalt für Bing's Algorithmus. Beispiele: ${sample}`,
      description_en: `These pages are reachable via crawling but Bing Webmaster Tools reports zero impressions — a signal that they're either not indexed by Bing or have negligible visibility there. Bing's index typically has gaps Google doesn't; common causes are unsubmitted sitemaps, missing Bing site verification, or pages with too thin content for Bing's algorithm. Examples: ${sample}`,
      recommendation_de: 'In Bing Webmaster Tools die Sitemap einreichen (Configure → Sitemaps), URL-Inspection für betroffene Pages ausführen, ggf. IndexNow integrieren um neue/geänderte URLs proaktiv zu pushen. Bei thinner Pages: Inhalt erweitern oder Pages konsolidieren.',
      recommendation_en: 'In Bing Webmaster Tools submit your sitemap (Configure → Sitemaps), run URL Inspection for the affected pages, and consider integrating IndexNow to proactively push new/changed URLs. For thin pages: expand the content or consolidate pages.',
      affectedUrl: withoutImpressions[0].url,
    });
  }

  // ============================================================
  //  bing-low-ctr-high-impressions  (Optional)
  // ============================================================
  // Queries that rank on Bing page-1 with healthy impression volume
  // but suspiciously low CTR. The interpretation is the same as for
  // GSC's twin finding — title/snippet doesn't sell the click — but
  // the threshold is stricter (1.5% vs 2%) to match Bing's lower
  // baseline.
  const lowCtrQueries = topQueries.filter(row =>
    row.impressions > LOW_CTR_MIN_IMPRESSIONS &&
    row.ctr < LOW_CTR_THRESHOLD &&
    row.position <= LOW_CTR_MAX_POSITION,
  );

  if (lowCtrQueries.length > 0) {
    // Sort worst-first by impressions — most user attention, least
    // click-through, highest leverage on a title rewrite.
    const sorted = [...lowCtrQueries].sort((a, b) => b.impressions - a.impressions);
    const sample = sorted.slice(0, QUERY_SAMPLE_SIZE).map(row => {
      const query = row.query ?? 'unknown';
      const ctrPct = (row.ctr * 100).toFixed(1);
      return `"${query}" (${row.impressions} Impressions, ${ctrPct}% CTR, Pos ${row.position.toFixed(1)})`;
    }).join('; ');

    findings.push({
      id: id(), priority: 'optional', module: 'seo', effort: 'low', impact: 'medium',
      title_de: `${lowCtrQueries.length} Bing-Suchanfrage(n) mit niedrigem CTR (<1,5%) auf Seite 1`,
      title_en: `${lowCtrQueries.length} Bing query/queries with low CTR (<1.5%) on page 1`,
      description_de: `Diese Suchanfragen ranken bei Bing auf Seite 1 (Position ≤ 10) mit > 100 Impressions, aber CTR unter 1,5%. Bing-CTRs liegen typischerweise unter Google-CTRs, daher die strengere Schwelle. Hohe Sichtbarkeit, niedrige Klickrate ist meist ein Title- oder Meta-Description-Problem. Beispiele: ${sample}`,
      description_en: `These queries rank on Bing page 1 (position ≤ 10) with > 100 impressions, but CTR under 1.5%. Bing CTRs sit lower than Google's typically, hence the stricter threshold. High visibility with low click-through is usually a title/meta-description problem. Examples: ${sample}`,
      recommendation_de: 'Title-Tag und Meta-Description der rankenden Pages neu schreiben — Bing nutzt diese Felder direkt für SERP-Snippets, mit weniger Auto-Rewrite als Google. Konkretes Nutzen-Versprechen vorne, Keyword im Title, klares Intent-Match. Schema.org-Markup hilft auch bei Bing für Rich-Snippets.',
      recommendation_en: 'Rewrite the title tag and meta description of the ranking pages — Bing uses these fields directly for SERP snippets with less auto-rewriting than Google. Concrete value promise up front, keyword in the title, clear intent match. Schema.org markup helps Bing too for rich snippets.',
    });
  }

  return findings;
}
