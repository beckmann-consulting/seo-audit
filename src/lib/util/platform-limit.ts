// ultimate-41: the time the new checks may take (journal ultimate-41-plan.md 1.6).
//
// `next start` does not enforce the audit route's `maxDuration` (Next 16.4.2 reads it only for type generation and
// the TypeScript rules; an audit ran 335 s through Caddy and `next start` to its result). Platforms that do enforce it
// stop the request there. The new checks end RESULT_RESERVE_MS before that line, so they never push an audit over
// it. The crawl and the older steps are not limited here; their own limits (maxPages, per-request timeouts) stay.

// Keep equal to `export const maxDuration` in app/api/audit/route.ts (Next wants a literal there; a test compares).
export const PLATFORM_MAX_DURATION_S = 900;
export const RESULT_RESERVE_MS = 30_000;
export const PLATFORM_LIMIT_MS = PLATFORM_MAX_DURATION_S * 1000 - RESULT_RESERVE_MS;

/** The moment the new checks of an audit started at `startMs` must be done by. */
export function newChecksDeadline(startMs: number): number {
  return startMs + PLATFORM_LIMIT_MS;
}

/** The time a step may use: its own budget, never past the deadline; 0 when nothing is left. */
export function stepBudget(ownMs: number, deadline: number, now: number = Date.now()): number {
  return Math.max(0, Math.min(ownMs, deadline - now));
}

export interface BudgetSetting {
  ms: number;
  // 'invalid': the variable was set but is no whole positive number, the default applies;
  // 'clamped': it was larger than the platform limit and was cut to it
  note?: 'invalid' | 'clamped';
}

/** A budget from an environment variable: default when unset or invalid, never above the platform limit. */
export function budgetFromEnv(raw: string | undefined, defaultMs: number): BudgetSetting {
  const base = Math.min(defaultMs, PLATFORM_LIMIT_MS);
  if (raw === undefined || raw.trim() === '') return { ms: base };
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return { ms: base, note: 'invalid' };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return { ms: base, note: 'invalid' };
  if (n > PLATFORM_LIMIT_MS) return { ms: PLATFORM_LIMIT_MS, note: 'clamped' };
  return { ms: n };
}

export const DEFAULT_BUDGETS_MS = {
  lighthouse: 360_000,
  hreflangProbes: 90_000,
  probes: 30_000, // the made-up URL (point 2) and http → https (point 3) together
} as const;

export interface NewCheckBudgets {
  lighthouse: BudgetSetting;
  hreflangProbes: BudgetSetting;
  probes: BudgetSetting;
}

/** The three budgets of the new checks, read when an audit starts. */
export function readNewCheckBudgets(env: Record<string, string | undefined> = process.env): NewCheckBudgets {
  return {
    lighthouse: budgetFromEnv(env.LIGHTHOUSE_BUDGET_MS, DEFAULT_BUDGETS_MS.lighthouse),
    hreflangProbes: budgetFromEnv(env.HREFLANG_PROBE_BUDGET_MS, DEFAULT_BUDGETS_MS.hreflangProbes),
    probes: budgetFromEnv(env.PROBE_BUDGET_MS, DEFAULT_BUDGETS_MS.probes),
  };
}

/** A line for the check log when a budget setting was not taken as given. */
export function budgetNote(name: string, s: BudgetSetting): { de: string; en: string } | undefined {
  if (s.note === 'clamped') return { de: `${name} auf die Plattformgrenze ${s.ms} ms begrenzt.`, en: `${name} cut to the platform limit ${s.ms} ms.` };
  if (s.note === 'invalid') return { de: `${name} ungültig, Vorgabe ${s.ms} ms.`, en: `${name} invalid, default ${s.ms} ms.` };
  return undefined;
}
