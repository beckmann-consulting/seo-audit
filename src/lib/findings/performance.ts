import type { Finding, PageSEOData, PageSpeedData } from '@/types';
import { analyzeLcpImage, describeImageHints } from '../util/lcp-image';
import { id } from './utils';

// Build the per-language element-context lines that get appended to
// LCP findings when Lighthouse identified a specific node. Returns
// empty strings when no element data is available, so callers can
// concat unconditionally.
function buildLcpElementContext(pageSpeed: PageSpeedData): {
  descSuffix_de: string;
  descSuffix_en: string;
  recSuffix_de: string;
  recSuffix_en: string;
} {
  const empty = { descSuffix_de: '', descSuffix_en: '', recSuffix_de: '', recSuffix_en: '' };
  const el = pageSpeed.lcpElement;
  if (!el) return empty;

  // Trim long snippets so the finding stays readable in PDF and UI.
  const snippet = el.snippet.length > 200 ? el.snippet.slice(0, 197) + '…' : el.snippet;

  const descSuffix_de = ` LCP-Element: ${el.selector} — ${snippet}`;
  const descSuffix_en = ` LCP element: ${el.selector} — ${snippet}`;

  const hints = describeImageHints(analyzeLcpImage(el.snippet));
  const recSuffix_de = hints.de.length > 0 ? ' ' + hints.de.join(' ') : '';
  const recSuffix_en = hints.en.length > 0 ? ' ' + hints.en.join(' ') : '';
  return { descSuffix_de, descSuffix_en, recSuffix_de, recSuffix_en };
}

// ============================================================
//  PERFORMANCE FINDINGS
// ============================================================
export function generatePerformanceFindings(pageSpeed?: PageSpeedData, pages?: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];

  // Render-blocking scripts — moved here from tech as part of D2
  if (pages && pages.length > 0) {
    const totalRenderBlocking = pages.reduce((s, p) => s + p.renderBlockingScripts, 0);
    if (totalRenderBlocking > 3) {
      findings.push({
        id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
        title_de: `${totalRenderBlocking} render-blockierende Scripts gefunden`,
        title_en: `${totalRenderBlocking} render-blocking scripts found`,
        description_de: 'Scripts im <head> ohne async/defer blockieren das Rendern und verlangsamen die wahrgenommene Ladezeit.',
        description_en: 'Scripts in the <head> without async/defer block rendering and slow down perceived load time.',
        recommendation_de: 'Externe Scripts mit defer oder async laden: <script src="..." defer>',
        recommendation_en: 'Load external scripts with defer or async: <script src="..." defer>',
      });
    }
  }

  if (!pageSpeed || pageSpeed.error) return findings;

  // Hysterese-Puffer: Lighthouse-Score variiert dokumentiert ±3-7 Punkte
  // zwischen Läufen selbst nach Multi-Run-Averaging. Schwellen wurden
  // von <50 auf <47 bzw. <75 auf <72 zurückgezogen, damit Scores im
  // Grenzbereich (48-50, 73-75) nicht zwischen Audits hin- und her-
  // kippen und das Finding konsistenter erscheint/verschwindet.
  if (pageSpeed.performanceScore !== undefined && pageSpeed.performanceScore < 47) {
    findings.push({
      id: id(), priority: 'critical', module: 'performance', effort: 'high', impact: 'high',
      title_de: `PageSpeed Score kritisch: ${pageSpeed.performanceScore}/100`,
      title_en: `PageSpeed score critical: ${pageSpeed.performanceScore}/100`,
      description_de: `Google Lighthouse Performance-Score: ${pageSpeed.performanceScore}/100. LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'}, CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'}, TBT: ${pageSpeed.tbt ? Math.round(pageSpeed.tbt) + 'ms' : 'n/a'}`,
      description_en: `Google Lighthouse Performance Score: ${pageSpeed.performanceScore}/100. LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'}, CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'}, TBT: ${pageSpeed.tbt ? Math.round(pageSpeed.tbt) + 'ms' : 'n/a'}`,
      recommendation_de: 'Bilder optimieren, Render-blocking Scripts entfernen, Server-Response-Zeit verbessern.',
      recommendation_en: 'Optimise images, remove render-blocking scripts, improve server response time.',
    });
  } else if (pageSpeed.performanceScore !== undefined && pageSpeed.performanceScore < 72) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `PageSpeed Score verbesserungswürdig: ${pageSpeed.performanceScore}/100`,
      title_en: `PageSpeed score needs improvement: ${pageSpeed.performanceScore}/100`,
      description_de: `LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'} (Ziel: <2.5s), CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'} (Ziel: <0.1)`,
      description_en: `LCP: ${pageSpeed.lcp ? Math.round(pageSpeed.lcp / 100) / 10 + 's' : 'n/a'} (target: <2.5s), CLS: ${pageSpeed.cls?.toFixed(3) ?? 'n/a'} (target: <0.1)`,
      recommendation_de: 'Core Web Vitals optimieren: LCP unter 2.5s, CLS unter 0.1, INP unter 200ms (FID unter 100ms als Legacy-Metrik).',
      recommendation_en: 'Optimise Core Web Vitals: LCP under 2.5s, CLS under 0.1, INP under 200ms (FID under 100ms as legacy metric).',
    });
  }

  // INP (Interaction to Next Paint) — replaced FID as Core Web Vital in March 2024
  if (pageSpeed.inp && pageSpeed.inp > 500) {
    findings.push({
      id: id(), priority: 'critical', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `INP kritisch: ${Math.round(pageSpeed.inp)}ms`,
      title_en: `INP critical: ${Math.round(pageSpeed.inp)}ms`,
      description_de: 'Interaction to Next Paint > 500ms wird von Google als "schlecht" eingestuft. INP misst die Reaktionsfähigkeit bei Nutzerinteraktionen und hat FID seit März 2024 als Core Web Vital ersetzt.',
      description_en: 'Interaction to Next Paint > 500ms is rated "poor" by Google. INP measures responsiveness to user interactions and replaced FID as a Core Web Vital in March 2024.',
      recommendation_de: 'JavaScript-Ausführung reduzieren, lange Tasks aufteilen, Event-Handler optimieren, nicht-kritische Scripts verzögern.',
      recommendation_en: 'Reduce JavaScript execution, break up long tasks, optimise event handlers, defer non-critical scripts.',
    });
  } else if (pageSpeed.inp && pageSpeed.inp > 200) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `INP verbesserungswürdig: ${Math.round(pageSpeed.inp)}ms`,
      title_en: `INP needs improvement: ${Math.round(pageSpeed.inp)}ms`,
      description_de: 'Interaction to Next Paint zwischen 200ms und 500ms gilt als verbesserungswürdig. Ziel: unter 200ms für eine flüssige Nutzerinteraktion.',
      description_en: 'Interaction to Next Paint between 200ms and 500ms is considered needing improvement. Target: under 200ms for smooth user interaction.',
      recommendation_de: 'Lange JavaScript-Tasks identifizieren (Performance-Panel im Browser), Event-Handler verschlanken, requestIdleCallback für Nicht-Prioritäres nutzen.',
      recommendation_en: 'Identify long JavaScript tasks (browser Performance panel), slim down event handlers, use requestIdleCallback for non-priority work.',
    });
  }

  // FID (Legacy — kept alongside INP for completeness)
  if (pageSpeed.fidField && pageSpeed.fidField > 300) {
    findings.push({
      id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `FID (Feld-Daten) hoch: ${Math.round(pageSpeed.fidField)}ms`,
      title_en: `FID (field data) high: ${Math.round(pageSpeed.fidField)}ms`,
      description_de: 'First Input Delay aus echten Nutzerdaten (CrUX) > 300ms. FID ist zwar durch INP als Core Web Vital abgelöst, bleibt aber ein Indikator für schlechte Interaktivität beim ersten Klick.',
      description_en: 'First Input Delay from real-user data (CrUX) > 300ms. FID has been replaced by INP as a Core Web Vital but remains an indicator of poor first-click responsiveness.',
      recommendation_de: 'Main-Thread-Blockaden reduzieren, kritisches JavaScript aufteilen.',
      recommendation_en: 'Reduce main-thread blocking, split up critical JavaScript.',
    });
  }

  if (pageSpeed.lcp && pageSpeed.lcp > 4000) {
    const ctx = buildLcpElementContext(pageSpeed);
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `Largest Contentful Paint zu langsam: ${Math.round(pageSpeed.lcp / 100) / 10}s`,
      title_en: `Largest Contentful Paint too slow: ${Math.round(pageSpeed.lcp / 100) / 10}s`,
      description_de: 'LCP > 4s ist ein kritisches Core Web Vital. Google stuft dies als "schlecht" ein.' + ctx.descSuffix_de,
      description_en: 'LCP > 4s is a critical Core Web Vital. Google rates this as "poor".' + ctx.descSuffix_en,
      recommendation_de: 'Hero-Bild preloaden, Server-Response-Zeit optimieren, nicht-kritische Scripts verzögern.' + ctx.recSuffix_de,
      recommendation_en: 'Preload hero image, optimise server response time, defer non-critical scripts.' + ctx.recSuffix_en,
    });
  } else if (pageSpeed.lcp && pageSpeed.lcp > 2500) {
    // 2.5–4s = "needs improvement" per Google's CWV rubric. Recommended
    // because the page isn't failing the threshold but is at risk.
    const ctx = buildLcpElementContext(pageSpeed);
    findings.push({
      id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `Largest Contentful Paint verbesserungswürdig: ${Math.round(pageSpeed.lcp / 100) / 10}s`,
      title_en: `Largest Contentful Paint needs improvement: ${Math.round(pageSpeed.lcp / 100) / 10}s`,
      description_de: 'LCP zwischen 2.5s und 4s liegt im "Verbesserungswürdig"-Bereich nach Google\'s Core-Web-Vital-Skala. Ziel: < 2.5s.' + ctx.descSuffix_de,
      description_en: 'LCP between 2.5s and 4s is rated "needs improvement" on Google\'s Core Web Vital scale. Target: < 2.5s.' + ctx.descSuffix_en,
      recommendation_de: 'Hero-Bild preloaden, Server-Response-Zeit optimieren, nicht-kritische Scripts verzögern.' + ctx.recSuffix_de,
      recommendation_en: 'Preload hero image, optimise server response time, defer non-critical scripts.' + ctx.recSuffix_en,
    });
  }

  // CLS (Cumulative Layout Shift) — lab data
  if (pageSpeed.cls !== undefined && pageSpeed.cls > 0.25) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'medium', impact: 'high',
      title_de: `CLS kritisch: ${pageSpeed.cls.toFixed(3)}`,
      title_en: `CLS poor: ${pageSpeed.cls.toFixed(3)}`,
      description_de: 'Cumulative Layout Shift > 0.25 wird von Google als "schlecht" eingestuft. Elemente springen beim Laden.',
      description_en: 'Cumulative Layout Shift > 0.25 is rated "poor" by Google. Elements jump around as the page loads.',
      recommendation_de: 'Bildern width/height-Attribute geben, Reservierungsplatz für Ads/Embeds einrichten, keine spät geladenen Fonts die den Text verschieben (font-display: optional/swap).',
      recommendation_en: 'Give images width/height attributes, reserve space for ads/embeds, avoid late-loading fonts that shift text (use font-display: optional/swap).',
    });
  } else if (pageSpeed.cls !== undefined && pageSpeed.cls > 0.1) {
    findings.push({
      id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `CLS verbesserungswürdig: ${pageSpeed.cls.toFixed(3)}`,
      title_en: `CLS needs improvement: ${pageSpeed.cls.toFixed(3)}`,
      description_de: 'CLS zwischen 0.1 und 0.25 gilt als verbesserungswürdig. Ziel ist < 0.1.',
      description_en: 'CLS between 0.1 and 0.25 is considered needing improvement. Target is < 0.1.',
      recommendation_de: 'Reservierten Platz für alle asynchron geladenen Elemente (Bilder, iframes, Ads, Embeds) einrichten.',
      recommendation_en: 'Reserve space for all async-loaded elements (images, iframes, ads, embeds).',
    });
  }

  // FCP — First Contentful Paint
  if (pageSpeed.fcp && pageSpeed.fcp > 3000) {
    findings.push({
      id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `FCP langsam: ${Math.round(pageSpeed.fcp / 100) / 10}s`,
      title_en: `FCP slow: ${Math.round(pageSpeed.fcp / 100) / 10}s`,
      description_de: 'First Contentful Paint > 3s bedeutet: Nutzer sehen mehrere Sekunden lang nur einen leeren Bildschirm.',
      description_en: 'First Contentful Paint > 3s means users stare at a blank screen for several seconds.',
      recommendation_de: 'Kritisches CSS inline ausliefern, Server-Response-Zeit reduzieren, render-blockierende Scripts entfernen.',
      recommendation_en: 'Inline critical CSS, reduce server response time, remove render-blocking scripts.',
    });
  }

  // TTFB — Server response time (from Lighthouse server-response-time audit)
  if (pageSpeed.ttfb && pageSpeed.ttfb > 1800) {
    findings.push({
      id: id(), priority: 'important', module: 'performance', effort: 'high', impact: 'high',
      title_de: `TTFB kritisch: ${Math.round(pageSpeed.ttfb)}ms`,
      title_en: `TTFB critical: ${Math.round(pageSpeed.ttfb)}ms`,
      description_de: 'Time to First Byte > 1800ms ist ein massiver Performance-Bremser. Ursache ist typischerweise langsames Backend, fehlendes Caching oder weit entfernter Server.',
      description_en: 'Time to First Byte > 1800ms is a massive performance drag. Typical causes: slow backend, missing caching, distant server.',
      recommendation_de: 'Server-Cache / CDN einrichten, Datenbank-Queries optimieren, Server näher an die Nutzer verlagern (Edge/CDN).',
      recommendation_en: 'Set up server cache / CDN, optimise DB queries, move server closer to users (edge/CDN).',
    });
  }

  // TBT — Total Blocking Time (correlates with INP)
  if (pageSpeed.tbt && pageSpeed.tbt > 600) {
    findings.push({
      id: id(), priority: 'recommended', module: 'performance', effort: 'medium', impact: 'medium',
      title_de: `TBT hoch: ${Math.round(pageSpeed.tbt)}ms`,
      title_en: `TBT high: ${Math.round(pageSpeed.tbt)}ms`,
      description_de: 'Total Blocking Time > 600ms bedeutet, dass der Haupt-Thread über längere Zeit blockiert ist. Korreliert stark mit schlechtem INP und FID.',
      description_en: 'Total Blocking Time > 600ms means the main thread is blocked for extended periods. Strongly correlates with bad INP and FID.',
      recommendation_de: 'JavaScript-Bundle reduzieren, lange Tasks (> 50ms) aufspalten, Web Workers für CPU-intensive Arbeit nutzen.',
      recommendation_en: 'Reduce JavaScript bundle, split long tasks (> 50ms), use Web Workers for CPU-heavy work.',
    });
  }

  return findings;
}

