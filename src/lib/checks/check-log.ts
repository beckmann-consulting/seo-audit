// ultimate-41: the check log. One entry per point of the order (journal ultimate-41-plan.md 1.2), always all of
// them and always in this order, so a run shows "passed", "not checkable" and so on as well as findings. The
// `check` key is stable and separate from the finding codes a check may give.
import type { CheckLogEntry, CheckStatus, Finding, Module } from '@/types';

export interface CheckPoint {
  check: string;
  point: string;
  modules: readonly Module[];
}

export const CHECK_POINTS = [
  { check: 'script-loading', point: '1', modules: ['performance', 'tech'] },
  { check: 'modern-image-formats', point: '16', modules: ['tech'] },
  { check: 'cookie-consent', point: '17', modules: ['legal'] },
  { check: 'soft-404', point: '2', modules: ['tech'] },
  { check: 'http-to-https', point: '3', modules: ['tech'] },
  { check: 'lighthouse-local', point: '4', modules: ['performance'] },
  { check: 'language-consistency', point: '5', modules: ['seo'] },
  { check: 'hreflang-targets', point: '6', modules: ['seo'] },
  { check: 'language-pairs', point: '7', modules: ['seo'] },
  { check: 'lang-and-og-locale', point: '19', modules: ['seo'] },
  { check: 'nap-consistency', point: '10', modules: ['seo'] },
  { check: 'maps-profile', point: '11', modules: ['seo'] },
  { check: 'target-keyword', point: '13', modules: ['seo'] },
  { check: 'inbound-anchors', point: '14', modules: ['seo'] },
  { check: 'meta-noindex', point: '18', modules: ['seo'] },
  { check: 'alt-text-quality', point: '20', modules: ['content'] },
  { check: 'ai-opening-hours', point: 'E1', modules: ['ai'] },
  { check: 'ai-last-modified', point: 'E2', modules: ['ai'] },
] as const satisfies readonly CheckPoint[];

export type CheckId = (typeof CHECK_POINTS)[number]['check'];

export interface CheckOutcome {
  status: Exclude<CheckStatus, 'not-selected'>;
  findings?: readonly Finding[];
  summary_de: string;
  summary_en: string;
}

const NOT_RUN = {
  summary_de: 'Prüfung lief in diesem Audit nicht.',
  summary_en: 'Check did not run in this audit.',
};

export class CheckLog {
  private readonly recorded = new Map<CheckId, CheckLogEntry>();

  constructor(private readonly selected: readonly Module[]) {}

  /** Whether the check belongs to a module the audit chose. */
  isSelected(check: CheckId): boolean {
    return pointOf(check).modules.some(m => this.selected.includes(m));
  }

  /**
   * One entry per check and run. `fail` comes with at least one finding, every other status with none, and every
   * finding carries a `code`; anything else is a programming error and throws, so tests catch it.
   */
  record(check: CheckId, outcome: CheckOutcome): void {
    if (this.recorded.has(check)) throw new Error(`check log: ${check} recorded twice`);
    if (!this.isSelected(check)) throw new Error(`check log: ${check} ran although none of its modules was chosen`);
    const findings = outcome.findings ?? [];
    if ((outcome.status === 'fail') !== (findings.length > 0)) {
      throw new Error(`check log: ${check} is ${outcome.status} with ${findings.length} finding(s)`);
    }
    const codes: string[] = [];
    for (const f of findings) {
      if (!f.code) throw new Error(`check log: a finding of ${check} has no code (${f.title_en})`);
      if (!codes.includes(f.code)) codes.push(f.code);
    }
    this.recorded.set(check, {
      check, point: pointOf(check).point, module: this.moduleOf(check), status: outcome.status,
      findingCodes: codes, summary_de: outcome.summary_de, summary_en: outcome.summary_en,
    });
  }

  has(check: CheckId): boolean {
    return this.recorded.has(check);
  }

  /** All points in their fixed order: not chosen → not-selected; chosen but never recorded → not-checkable. */
  entries(): CheckLogEntry[] {
    return CHECK_POINTS.map(p => {
      const done = this.recorded.get(p.check);
      if (done) return done;
      const selected = this.isSelected(p.check);
      return {
        check: p.check, point: p.point, module: this.moduleOf(p.check),
        status: selected ? 'not-checkable' : 'not-selected', findingCodes: [],
        summary_de: selected ? NOT_RUN.summary_de : 'Modul nicht gewählt.',
        summary_en: selected ? NOT_RUN.summary_en : 'Module not chosen.',
      };
    });
  }

  private moduleOf(check: CheckId): Module {
    const p = pointOf(check);
    return p.modules.find(m => this.selected.includes(m)) ?? p.modules[0];
  }
}

function pointOf(check: CheckId): CheckPoint {
  const p = CHECK_POINTS.find(c => c.check === check);
  if (!p) throw new Error(`check log: unknown check ${check}`);
  return p;
}

/** `fail` with the findings when there are any, else the given status (usually `pass`). */
export function outcome(findings: readonly Finding[], otherwise: Omit<CheckOutcome, 'findings'>, failSummary?: { de: string; en: string }): CheckOutcome {
  if (findings.length === 0) return otherwise;
  return {
    status: 'fail', findings,
    summary_de: failSummary?.de ?? `${findings.length} Befund(e).`,
    summary_en: failSummary?.en ?? `${findings.length} finding(s).`,
  };
}
