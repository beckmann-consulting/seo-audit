import type { Finding, Module, Priority } from '@/types';

// ============================================================
//  Shared ID counter — used by every finding generator so each
//  Finding gets a stable, crawl-unique id within a single run.
// ============================================================
let findingCounter = 0;
export function id(): string {
  return `f${++findingCounter}`;
}

// ============================================================
//  SCORING
// ============================================================
export function calculateModuleScore(findings: Finding[], module: Module, maxPossible: number = 100): number {
  const moduleFindings = findings.filter(f => f.module === module);
  let penalty = 0;
  moduleFindings.forEach(f => {
    if (f.priority === 'critical') penalty += 25;
    else if (f.priority === 'important') penalty += 12;
    else if (f.priority === 'recommended') penalty += 5;
    else penalty += 2;
  });
  return Math.max(0, Math.min(100, maxPossible - penalty));
}

// ============================================================
//  TOP FINDINGS RANKING
// ============================================================
// Each finding gets an impact score = priority base × module weight.
// Priority base:   critical 100, important 60, recommended 30, optional 10.
// Module weight:   seo 1.5, performance 1.4, tech 1.3, content 1.2, ux 1.1, legal 1.0
// Modules not listed default to 1.0.
const PRIORITY_BASE: Record<Priority, number> = {
  critical: 100,
  important: 60,
  recommended: 30,
  optional: 10,
};

const MODULE_WEIGHT: Record<string, number> = {
  seo: 1.5,
  performance: 1.4,
  // Accessibility findings come from axe-core — concrete WCAG-tagged
  // violations rather than heuristics, so they sit just below tech in
  // weight and ahead of content/ux/legal.
  accessibility: 1.35,
  tech: 1.3,
  content: 1.2,
  ux: 1.1,
  legal: 1.0,
};

export function findingImpactScore(finding: Finding): number {
  const base = PRIORITY_BASE[finding.priority] ?? 0;
  const weight = MODULE_WEIGHT[finding.module] ?? 1.0;
  return base * weight;
}

// Estimated score gain if the finding is fixed — aligned with the
// per-priority penalty applied by calculateModuleScore().
export function estimateScoreGain(finding: Finding): number {
  switch (finding.priority) {
    case 'critical': return 25;
    case 'important': return 12;
    case 'recommended': return 5;
    case 'optional': return 2;
  }
}

export function getTopFindings(findings: Finding[], n: number): Finding[] {
  return [...findings]
    .sort((a, b) => {
      const diff = findingImpactScore(b) - findingImpactScore(a);
      if (diff !== 0) return diff;
      // Deterministic tie-break by id (alphabetical)
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.max(0, n));
}
