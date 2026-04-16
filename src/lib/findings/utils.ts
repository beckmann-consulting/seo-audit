import type { Finding, Module } from '@/types';

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
