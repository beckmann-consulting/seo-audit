// ultimate-41, point 4: a local Lighthouse result for the UI and PDF tests (one pair not measured).
import type { LighthouseLocalInfo } from '@/types';

export const LIGHTHOUSE_FIXTURE: LighthouseLocalInfo = {
  lighthouseVersion: '13.6.0', chromiumVersion: '142.0.7444.59', durationMs: 183_000, runsPerPair: 3, complete: false,
  notes: ['budget used up before https://example.com/b desktop run 1'],
  pairs: [
    { url: 'https://example.com/', strategy: 'mobile', runScores: [60, 90, 75], medianScore: 75, median: { score: 75, lcp: 2500, cls: 0.012, tbt: 140 }, errors: [] },
    { url: 'https://example.com/', strategy: 'desktop', runScores: [98, 97, 99], medianScore: 98, median: { score: 98, lcp: 800, cls: 0, tbt: 10 }, errors: [] },
    { url: 'https://example.com/b', strategy: 'mobile', runScores: [70, 71, 69], medianScore: 70, median: { score: 70, lcp: 3100, cls: 0.05, tbt: 200 }, errors: [] },
    { url: 'https://example.com/b', strategy: 'desktop', runScores: [], errors: [] },
  ],
};
