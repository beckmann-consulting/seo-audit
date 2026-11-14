import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PLATFORM_MAX_DURATION_S, PLATFORM_LIMIT_MS, RESULT_RESERVE_MS, newChecksDeadline, stepBudget, budgetFromEnv,
  readNewCheckBudgets, budgetNote, DEFAULT_BUDGETS_MS,
} from './platform-limit';

describe('platform limit of the new checks (ultimate-41)', () => {
  it('equals maxDuration of the audit route, minus the reserve for the result', () => {
    const src = readFileSync(path.join(__dirname, '../../app/api/audit/route.ts'), 'utf8');
    const m = src.match(/^export const maxDuration = (\d+);/m);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(PLATFORM_MAX_DURATION_S);
    expect(PLATFORM_LIMIT_MS).toBe(PLATFORM_MAX_DURATION_S * 1000 - RESULT_RESERVE_MS);
  });

  it('a step gets its own budget, never past the deadline, and 0 when nothing is left', () => {
    const start = 1_000_000;
    const deadline = newChecksDeadline(start);
    expect(deadline).toBe(start + 870_000);
    expect(stepBudget(360_000, deadline, start)).toBe(360_000);
    expect(stepBudget(360_000, deadline, deadline - 100_000)).toBe(100_000);
    expect(stepBudget(360_000, deadline, deadline)).toBe(0);
    expect(stepBudget(360_000, deadline, deadline + 5_000)).toBe(0);
  });

  it('environment values: unset and invalid give the default, too large is cut to the platform limit', () => {
    expect(budgetFromEnv(undefined, 90_000)).toEqual({ ms: 90_000 });
    expect(budgetFromEnv('  ', 90_000)).toEqual({ ms: 90_000 });
    expect(budgetFromEnv('120000', 90_000)).toEqual({ ms: 120_000 });
    for (const bad of ['-5', '0', '1.5', 'abc', '1e6', '99999999999999999999']) {
      expect(budgetFromEnv(bad, 90_000), bad).toEqual({ ms: 90_000, note: 'invalid' });
    }
    expect(budgetFromEnv(String(PLATFORM_LIMIT_MS + 1), 90_000)).toEqual({ ms: PLATFORM_LIMIT_MS, note: 'clamped' });
    expect(budgetFromEnv(String(PLATFORM_LIMIT_MS), 90_000)).toEqual({ ms: PLATFORM_LIMIT_MS });
  });

  it('the three budgets are read from their variables, with their defaults', () => {
    expect(readNewCheckBudgets({})).toEqual({
      lighthouse: { ms: DEFAULT_BUDGETS_MS.lighthouse }, hreflangProbes: { ms: DEFAULT_BUDGETS_MS.hreflangProbes }, probes: { ms: DEFAULT_BUDGETS_MS.probes },
    });
    const b = readNewCheckBudgets({ LIGHTHOUSE_BUDGET_MS: '9999999', HREFLANG_PROBE_BUDGET_MS: 'x', PROBE_BUDGET_MS: '15000' });
    expect(b.lighthouse).toEqual({ ms: PLATFORM_LIMIT_MS, note: 'clamped' });
    expect(b.hreflangProbes).toEqual({ ms: DEFAULT_BUDGETS_MS.hreflangProbes, note: 'invalid' });
    expect(b.probes).toEqual({ ms: 15_000 });
    expect(budgetNote('LIGHTHOUSE_BUDGET_MS', b.lighthouse)?.en).toMatch(/cut to the platform limit 870000 ms/);
    expect(budgetNote('PROBE_BUDGET_MS', b.probes)).toBeUndefined();
  });
});
