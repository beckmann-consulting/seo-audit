import type { AuditDiff, AuditResult, Finding } from '@/types';

// ============================================================
//  Compute diff between two AuditResults for the same domain.
// ============================================================
// Finding comparison is done by finding.id. Note that the id() counter
// in findings/utils.ts resets on every audit run and increments
// deterministically, so the same site audited twice with no changes
// produces matching ids for matching findings. When the underlying
// data changes and a finding appears/disappears in the middle of the
// emission order, downstream ids shift by one — that can show up as
// a pair of (resolved + new) findings rather than "unchanged". Title-
// based matching was considered but rejected because many titles
// contain counts that change run-to-run ("5 pages missing title").
export function computeDiff(
  current: AuditResult,
  previous: AuditResult,
  previousDate: string
): AuditDiff {
  const prevIds = new Set(previous.findings.map(f => f.id));
  const currIds = new Set(current.findings.map(f => f.id));

  const resolved: Finding[] = previous.findings.filter(f => !currIds.has(f.id));
  const newFindings: Finding[] = current.findings.filter(f => !prevIds.has(f.id));
  const unchanged: Finding[] = current.findings.filter(f => prevIds.has(f.id));

  const prevModuleMap = new Map(previous.moduleScores.map(m => [m.module, m.score]));
  const moduleDeltas: { module: string; delta: number }[] = [];
  for (const m of current.moduleScores) {
    const prevScore = prevModuleMap.get(m.module);
    if (prevScore !== undefined) {
      moduleDeltas.push({ module: m.module, delta: m.score - prevScore });
    }
  }

  return {
    domain: current.domain,
    currentAudit: current,
    previousAudit: previous,
    previousAuditDate: previousDate,
    resolved,
    new: newFindings,
    unchanged,
    scoreDelta: current.totalScore - previous.totalScore,
    moduleDeltas,
  };
}

// ============================================================
//  Minimal runtime shape check for uploaded AuditResult JSON.
// ============================================================
// Full validation would require a schema library; this is
// intentionally light — enough to catch completely wrong files
// without hauling in zod for a single call-site.
export function isValidAuditResult(value: unknown): value is AuditResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.totalScore !== 'number') return false;
  if (!Array.isArray(v.findings)) return false;
  if (!Array.isArray(v.moduleScores)) return false;
  if (typeof v.domain !== 'string') return false;
  if (typeof v.auditedAt !== 'string') return false;
  return true;
}
