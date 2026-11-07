// Coverage and score of the AI visibility module, and the weighted total.
//
// - Assessable are checks 1, 2, 4, 5, 6 and 7 with the status pass or fail;
//   llms.txt never is.
// - The module score uses calculateModuleScore over score entries: the
//   module's own findings plus, for a failed check whose finding another
//   module owns, a shadow entry with that priority. Shadow entries are no
//   findings: they never reach the list, the PDF, the CSV or the Top 5.
// - Without an assessable check the module has no score: it is left out of
//   moduleScores and of the total, so it can never raise it.
// - The total is a weighted mean: every module 1, ai 0.5 (V1). Without ai it
//   is exactly the plain mean of before.

import { calculateModuleScore } from '@/lib/findings/utils';
import type { Finding, Module, ModuleScore } from '@/types';
import type { AICheckId, AICheckResult } from './types';

export const ASSESSABLE_CHECKS: AICheckId[] = ['crawlers', 'snippets', 'structured', 'nojs', 'answers', 'trust'];

export function aiCoverage(checks: AICheckResult[]): { assessable: number; total: number } {
  const assessable = checks.filter(c => ASSESSABLE_CHECKS.includes(c.id) && (c.status === 'pass' || c.status === 'fail')).length;
  return { assessable, total: ASSESSABLE_CHECKS.length };
}

export function aiModuleScore(checks: AICheckResult[], findings: Finding[]): number | undefined {
  if (aiCoverage(checks).assessable === 0) return undefined;
  const entries: Finding[] = findings.filter(f => f.module === 'ai');
  for (const c of checks) {
    if (c.status !== 'fail') continue;
    for (const s of c.shadow) {
      entries.push({
        id: `shadow-${c.id}-${s.signal}`, priority: s.priority, module: 'ai', effort: 'low', impact: 'low',
        title_de: '', title_en: '', description_de: '', description_en: '', recommendation_de: '', recommendation_en: '',
      });
    }
  }
  return calculateModuleScore(entries, 'ai');
}

export const TOTAL_WEIGHT: Partial<Record<Module, number>> = { ai: 0.5 };

export function weightedTotal(moduleScores: ModuleScore[]): number {
  if (moduleScores.length === 0) return 50;
  let sum = 0;
  let weights = 0;
  for (const m of moduleScores) {
    const w = TOTAL_WEIGHT[m.module] ?? 1;
    sum += m.score * w;
    weights += w;
  }
  return Math.round(sum / weights);
}
