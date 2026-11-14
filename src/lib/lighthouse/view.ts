// ultimate-41, point 4: how the local Lighthouse table reads in the UI and the PDF (one source for both).
import type { Lang, LighthouseLocalInfo } from '@/types';

export interface LighthouseRow {
  url: string;
  strategy: string; // mobil / Desktop, mobile / desktop
  score: string; // of the median run, "n/a" when not measured
  lcp: string;
  cls: string;
  tbt: string;
  runs: string; // the scores of every run, e.g. "60, 90, 75"
}

export function lighthouseTitle(info: LighthouseLocalInfo, lang: Lang): string {
  return lang === 'de'
    ? `Lighthouse lokal, Labormessung (Median-Lauf aus ${info.runsPerPair} Läufen)`
    : `Local Lighthouse, lab measurement (median run of ${info.runsPerPair} runs)`;
}

export function lighthouseRows(info: LighthouseLocalInfo, lang: Lang): LighthouseRow[] {
  const de = lang === 'de';
  return info.pairs.map(p => ({
    url: p.url,
    strategy: p.strategy === 'mobile' ? (de ? 'mobil' : 'mobile') : 'Desktop',
    score: p.median ? String(p.median.score) : 'n/a',
    lcp: p.median?.lcp !== undefined ? `${(p.median.lcp / 1000).toFixed(1)} s` : 'n/a',
    cls: p.median?.cls !== undefined ? p.median.cls.toFixed(3) : 'n/a',
    tbt: p.median?.tbt !== undefined ? `${Math.round(p.median.tbt)} ms` : 'n/a',
    runs: p.runScores.length > 0 ? p.runScores.join(', ') : (de ? 'nicht gemessen' : 'not measured'),
  }));
}

/** Versions and notes under the table. */
export function lighthouseFooter(info: LighthouseLocalInfo, lang: Lang): string {
  const parts = [
    info.lighthouseVersion ? `Lighthouse ${info.lighthouseVersion}` : undefined,
    info.chromiumVersion ? `Chromium ${info.chromiumVersion}` : undefined,
    `${Math.round(info.durationMs / 1000)} s`,
    info.complete ? undefined : (lang === 'de' ? 'unvollständig' : 'incomplete'),
    ...info.notes,
  ].filter(Boolean);
  return parts.join(' · ');
}
