// Pure validators for the audit-form fields. Lives outside AuditApp.tsx
// so the regex-compile rules stay unit-testable without spinning up a
// React tree.

export type PatternError = { which: 'include' | 'exclude'; pattern: string };

// Returns the first invalid regex across both lists, or null when
// every non-empty line compiles. Whitespace-only lines are ignored —
// the runAudit pipeline strips them anyway via splitLines().
//
// Priority: include lines are checked before exclude. If both lists
// have invalid patterns, the include-side surfaces first; the exclude
// error becomes visible once the include is fixed (live-validation
// re-runs on every keystroke).
export function checkPatterns(include: string, exclude: string): PatternError | null {
  for (const line of include.split('\n').map(l => l.trim()).filter(Boolean)) {
    try { new RegExp(line); } catch { return { which: 'include', pattern: line }; }
  }
  for (const line of exclude.split('\n').map(l => l.trim()).filter(Boolean)) {
    try { new RegExp(line); } catch { return { which: 'exclude', pattern: line }; }
  }
  return null;
}
