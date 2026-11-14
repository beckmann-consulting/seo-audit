// ultimate-41, point 4: Lighthouse on this server, without a Google key (journal ultimate-41-plan.md B4).
//
// The start page and the two most internally linked pages, each mobile and desktop, 3 runs per pair, one after the
// other. Each pair is summed up by its median run, chosen with Lighthouse's own computeMedianRun (the run closest to
// the median of FCP and TTI), so the score and the lab values come from one run. Lab values stay here; only the
// median-run score of the start page on mobile goes into the performance score (route.ts), as PSI's does.
//
// A run starts only when it still fits into the budget whole (60 s). When the budget runs out during a run, that run
// is aborted (the runner kills Chromium and closes the proxy); the result keeps the finished runs and is not complete.
import type { CheckOutcome } from '@/lib/checks/check-log';
import type { Finding, LighthouseLabMetrics, LighthouseLocalInfo, LighthousePair, PageSEOData } from '@/types';
import { id } from '@/lib/findings/utils';
import { IMPRINT_URL_PATTERNS, PRIVACY_URL_PATTERNS, COOKIE_URL_PATTERNS, TERMS_URL_PATTERNS, pathMatchesAny } from '@/lib/util/legal-page-detection';

export type Strategy = 'mobile' | 'desktop';
export const STRATEGIES: Strategy[] = ['mobile', 'desktop'];
export const RUN_MS = 60_000;
export const DEFAULT_PAGES = 3;
export const MIN_RUNS = 3;

/** The parts of a Lighthouse result this module reads. */
export interface LhrLike {
  lighthouseVersion?: string;
  environment?: { hostUserAgent?: string };
  categories: { performance?: { score: number | null } };
  audits: Record<string, { numericValue?: number } | undefined>;
}

export interface LighthouseRunner {
  run(url: string, strategy: Strategy, timeoutMs: number): Promise<LhrLike>;
  close(): Promise<void>;
}

export interface MeasureOptions {
  urls: string[];
  runs: number;
  deadline: number;
  runner: LighthouseRunner;
  now?: () => number;
  onProgress?: (detail: string) => void;
}

const num = (lhr: LhrLike, audit: string) => lhr.audits[audit]?.numericValue;

export function metricsOf(lhr: LhrLike): LighthouseLabMetrics {
  return {
    score: Math.round((lhr.categories.performance?.score ?? 0) * 100),
    fcp: num(lhr, 'first-contentful-paint'),
    lcp: num(lhr, 'largest-contentful-paint'),
    tbt: num(lhr, 'total-blocking-time'),
    cls: num(lhr, 'cumulative-layout-shift'),
    si: num(lhr, 'speed-index'),
  };
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** The median run of a pair, by Lighthouse's own method; without FCP or TTI in every run, the run of the median score. */
export async function medianRun(lhrs: LhrLike[]): Promise<LhrLike> {
  const usable = lhrs.every(l => Number.isFinite(num(l, 'first-contentful-paint')) && Number.isFinite(num(l, 'interactive')));
  if (usable) {
    const { computeMedianRun } = await import('lighthouse/core/lib/median-run.js');
    return computeMedianRun(lhrs as never) as unknown as LhrLike;
  }
  const scored = [...lhrs].sort((a, b) => metricsOf(a).score - metricsOf(b).score);
  return scored[Math.floor((scored.length - 1) / 2)];
}

const LEGAL_PATTERNS = [...IMPRINT_URL_PATTERNS, ...PRIVACY_URL_PATTERNS, ...COOKIE_URL_PATTERNS, ...TERMS_URL_PATTERNS];
const isLegal = (url: string) => { try { return pathMatchesAny(new URL(url).pathname, LEGAL_PATTERNS); } catch { return false; } };

/**
 * The start page and the most internally linked other pages (ties: alphabetical), answered 200. Legal pages
 * (imprint, privacy, cookies, terms) are left out: the footer links them from every page, which says nothing
 * about their weight (the first proof run on beckmanndigital.com picked the privacy policy).
 */
export function pickLighthousePages(pages: PageSEOData[], n: number = DEFAULT_PAGES): string[] {
  const ok = pages.filter(p => p.httpStatus === 200 && (p.depth === 0 || !isLegal(p.url)));
  const start = ok.find(p => p.depth === 0) ?? ok[0];
  if (!start) return [];
  const inlinks = new Map<string, number>();
  for (const p of ok) for (const l of new Set(p.internalLinks)) inlinks.set(l, (inlinks.get(l) ?? 0) + 1);
  const rest = ok.filter(p => p !== start && p.url !== start.url)
    .sort((a, b) => (inlinks.get(b.url) ?? 0) - (inlinks.get(a.url) ?? 0) || a.url.localeCompare(b.url));
  return [start.url, ...rest.slice(0, Math.max(0, n - 1)).map(p => p.url)];
}

export async function measureLighthouse(o: MeasureOptions): Promise<LighthouseLocalInfo> {
  const now = o.now ?? Date.now;
  const started = now();
  const pairs: LighthousePair[] = o.urls.flatMap(url => STRATEGIES.map(strategy => ({ url, strategy, runScores: [], errors: [] }) as LighthousePair));
  const lhrsOf = new Map<LighthousePair, LhrLike[]>();
  const notes: string[] = [];
  let version: string | undefined;
  let chromium: string | undefined;
  let stopped = false;
  try {
    for (const pair of pairs) {
      const lhrs: LhrLike[] = [];
      lhrsOf.set(pair, lhrs);
      for (let r = 1; r <= o.runs && !stopped; r++) {
        const left = o.deadline - now();
        if (left < RUN_MS) { stopped = true; notes.push(`budget used up before ${pair.url} ${pair.strategy} run ${r}`); break; }
        o.onProgress?.(`${pair.url} ${pair.strategy} ${r}/${o.runs}`);
        try {
          const lhr = await o.runner.run(pair.url, pair.strategy, Math.min(RUN_MS, left));
          lhrs.push(lhr);
          pair.runScores.push(metricsOf(lhr).score);
          version ??= lhr.lighthouseVersion;
          chromium ??= lhr.environment?.hostUserAgent?.match(/(?:Headless)?Chrome\/([\d.]+)/)?.[1];
        } catch (e) {
          pair.errors.push(String((e as Error)?.message ?? e));
        }
      }
      if (stopped) break;
    }
  } finally {
    await o.runner.close();
  }
  for (const pair of pairs) {
    const lhrs = lhrsOf.get(pair) ?? [];
    if (lhrs.length === 0) continue;
    pair.median = metricsOf(await medianRun(lhrs));
    pair.medianScore = median(pair.runScores);
  }
  return {
    lighthouseVersion: version, chromiumVersion: chromium, durationMs: now() - started, runsPerPair: o.runs, pairs,
    complete: pairs.every(p => p.runScores.length >= o.runs), notes,
  };
}

const fmt = (m?: LighthouseLabMetrics) => m
  ? `LCP ${m.lcp !== undefined ? `${(m.lcp / 1000).toFixed(1)} s` : 'n/a'}, TBT ${m.tbt !== undefined ? `${Math.round(m.tbt)} ms` : 'n/a'}, CLS ${m.cls !== undefined ? m.cls.toFixed(3) : 'n/a'}`
  : 'n/a';

/** Findings from local lab values ("Labormessung, lokal"), the check log outcome, and the score for the module. */
export function lighthouseFindings(info: LighthouseLocalInfo): { findings: Finding[]; outcome: CheckOutcome; homeMobileScore?: number } {
  const findings: Finding[] = [];
  // only pairs measured with every planned run count; a pair cut short says nothing (journal plan B4, status rule)
  const done = (p: LighthousePair) => p.runScores.length >= info.runsPerPair && p.median !== undefined;
  const home = info.pairs[0];
  const homeMobile = home && home.strategy === 'mobile' && done(home) ? home.median : undefined;
  if (homeMobile && homeMobile.score < 72) {
    const critical = homeMobile.score < 47;
    findings.push({
      id: id(), code: 'performance.lighthouse-home', priority: critical ? 'important' : 'recommended', module: 'performance',
      effort: 'high', impact: 'high', affectedUrl: home.url,
      title_de: `Lighthouse (Labormessung, lokal) Startseite mobil: ${homeMobile.score}/100`,
      title_en: `Lighthouse (lab, local) start page on mobile: ${homeMobile.score}/100`,
      description_de: `Median-Lauf aus ${home.runScores.length} Läufen (Scores ${home.runScores.join(', ')}): ${fmt(homeMobile)}. Labormessung mit simulierter Drosselung, keine Felddaten.`,
      description_en: `Median run of ${home.runScores.length} runs (scores ${home.runScores.join(', ')}): ${fmt(homeMobile)}. Lab measurement with simulated throttling, no field data.`,
      recommendation_de: 'Größte Bremsen im Lighthouse-Bericht zuerst angehen: LCP-Bild, blockierende Ressourcen, JavaScript-Last.',
      recommendation_en: 'Tackle the biggest brakes of the Lighthouse report first: the LCP image, blocking resources, JavaScript load.',
    });
  }
  const others = info.pairs.filter(p => p !== home && done(p) && (p.median?.score ?? 100) < 72);
  if (others.length > 0) {
    const anyCritical = others.some(p => (p.median?.score ?? 100) < 47);
    const list = others.slice(0, 6).map(p => `${p.url} ${p.strategy}: ${p.median?.score}`).join('; ');
    findings.push({
      id: id(), code: 'performance.lighthouse-pages', priority: anyCritical ? 'recommended' : 'optional', module: 'performance',
      effort: 'high', impact: 'medium', affectedUrl: others[0].url,
      title_de: `Lighthouse (Labormessung, lokal): ${others.length} Seite(n) oder Desktop unter 72`,
      title_en: `Lighthouse (lab, local): ${others.length} page(s) or desktop below 72`,
      description_de: `Median-Läufe aus je ${info.runsPerPair} Läufen: ${list}.`,
      description_en: `Median runs of ${info.runsPerPair} runs each: ${list}.`,
      recommendation_de: 'Die schwächsten Seiten einzeln im Lighthouse-Bericht prüfen.',
      recommendation_en: 'Check the weakest pages one by one in the Lighthouse report.',
    });
  }
  const measured = info.pairs.filter(p => p.runScores.length >= info.runsPerPair).length;
  const summaryCore = info.pairs.filter(p => p.median).map(p => `${p.url} ${p.strategy} ${p.median?.score}`).slice(0, 6).join('; ');
  let outcome: CheckOutcome;
  if (findings.length > 0) {
    outcome = { status: 'fail', findings, summary_de: `Median-Läufe: ${summaryCore}.`, summary_en: `Median runs: ${summaryCore}.` };
  } else if (!info.complete) {
    outcome = {
      status: 'not-checkable',
      summary_de: `${measured} von ${info.pairs.length} Paaren aus Seite und Strategie mit ${info.runsPerPair} Läufen gemessen.${info.notes.length ? ` ${info.notes.join('; ')}.` : ''}`,
      summary_en: `${measured} of ${info.pairs.length} pairs of page and strategy measured with ${info.runsPerPair} runs.${info.notes.length ? ` ${info.notes.join('; ')}.` : ''}`,
    };
  } else {
    outcome = { status: 'pass', summary_de: `Alle Median-Läufe ab 72: ${summaryCore}.`, summary_en: `Every median run at 72 or more: ${summaryCore}.` };
  }
  return { findings, outcome, homeMobileScore: homeMobile?.score };
}
