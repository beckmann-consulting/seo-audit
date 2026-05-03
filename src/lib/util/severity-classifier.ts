// Severity classifiers — single source of truth so the HTML Tech tab
// (AuditApp.TechRow) and the PDF Tech Details (pdf-generator.techRow)
// produce identical, defensible coloring without duplicating per-feature
// rules at every call site.
//
// The 5-level vocabulary maps onto the existing visual tokens:
//   good    → --pass    (green) — affirmative, working as intended
//   warn    → --warn    (amber) — needs attention, not broken
//   bad     → --fail    (red)   — actually broken / showstopper
//   info    → --info    (blue)  — emerging standard, informational
//   neutral → text-strong/grey  — default state, no opinion
//
// Per-feature rationales live in code comments next to each classifier;
// the goal is that every "this is amber not red" decision is auditable
// at the source rather than hidden in render-layer ternaries.

import type { AIBotStatus } from '@/types';

export type Severity = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

// ============================================================
//  AI CRAWLER READINESS
// ============================================================
// The default state for ~99% of websites is "unspecified" — i.e. no
// explicit directive in robots.txt for that bot. That's not a defect,
// it's the absence of an opt-in/opt-out decision. Marking it red used
// to make harmless audits look catastrophic; neutral grey is honest.
export function classifyAIBotRow(status: AIBotStatus): Severity {
  switch (status) {
    case 'allowed':     return 'good';
    case 'partial':     return 'warn';
    case 'blocked':     return 'warn';   // single-row warning; total
                                          // retrieval-block is escalated
                                          // by generateAIReadinessFindings
    case 'unspecified': return 'neutral';
  }
}

// llms.txt + llms-full.txt: ~10% adoption, no major LLM provider has
// committed to honouring them. Missing is informational, not a defect.
export function classifyLlmsTxt(present: boolean): Severity {
  return present ? 'good' : 'info';
}

// ============================================================
//  SECURITY HEADERS
// ============================================================
// References: OWASP Secure Headers Project, Mozilla Web Security
// Guidelines. Most headers grade as "warn when missing" rather than
// "bad", because a typical marketing site without them isn't "broken"
// — it's missing modern hardening. CSP especially is a warning, not
// a critical, since most live sites lack one.

export interface SecurityHeaderInputs {
  hsts?: string;
  hstsMaxAge?: number;
  csp?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
  hasMixedContent?: boolean;
}

// 6 months is OWASP's "minimum recommended"; below that the protection
// window is too short to matter for most threat models.
const HSTS_MIN_RECOMMENDED_SECONDS = 6 * 30 * 24 * 60 * 60;

export function classifyHsts(inp: SecurityHeaderInputs): Severity {
  if (!inp.hsts) return 'warn';
  if ((inp.hstsMaxAge ?? 0) < HSTS_MIN_RECOMMENDED_SECONDS) return 'warn';
  return 'good';
}

export function classifyXContentTypeOptions(inp: SecurityHeaderInputs): Severity {
  if (!inp.xContentTypeOptions) return 'warn';
  return inp.xContentTypeOptions.toLowerCase() === 'nosniff' ? 'good' : 'warn';
}

// X-Frame-Options is officially obsoleted by CSP frame-ancestors per
// MDN and OWASP — if frame-ancestors is in CSP, XFO is redundant.
export function classifyXFrameOptions(inp: SecurityHeaderInputs): Severity {
  if (inp.xFrameOptions) return 'good';
  if (/frame-ancestors/i.test(inp.csp ?? '')) return 'good';
  return 'warn';
}

// CSP missing is a warning, not bad. Most marketing sites lack one and
// flagging them red creates alarmism. CSP with unsafe-inline / unsafe-
// eval is also warned (meaningfully weakens protection).
export function classifyCsp(inp: SecurityHeaderInputs): Severity {
  if (!inp.csp) return 'warn';
  if (/'unsafe-(inline|eval)'/i.test(inp.csp)) return 'warn';
  return 'good';
}

export function classifyReferrerPolicy(inp: SecurityHeaderInputs): Severity {
  return inp.referrerPolicy ? 'good' : 'warn';
}

// Permissions-Policy is still emerging as a baseline expectation —
// flagging as info, not warn.
export function classifyPermissionsPolicy(inp: SecurityHeaderInputs): Severity {
  return inp.permissionsPolicy ? 'good' : 'info';
}

// Mixed content on an HTTPS site IS a real defect: every browser flags
// it, browsers may block subresources, and it weakens HTTPS guarantees.
export function classifyMixedContent(hasMixedContent: boolean): Severity {
  return hasMixedContent ? 'bad' : 'good';
}

// ============================================================
//  REDIRECTS
// ============================================================
// A single normalisation hop (apex→www, http→https, trailing-slash) is
// completely normal — every well-configured site has at least one. We
// only escalate when there's a structural issue.

export interface RedirectInputs {
  redirectedCount: number;   // pages reached via at least one hop
  chainCount: number;        // pages whose chain has > 1 hop
  loopCount: number;         // pages whose chain contains a cycle
  downgradeCount: number;    // pages whose chain ends on http://
}

export function classifyRedirected(inp: RedirectInputs): Severity {
  if (inp.loopCount > 0 || inp.downgradeCount > 0) return 'bad';
  if (inp.redirectedCount <= 1) return 'good';   // 0 or single normalisation
  return 'neutral';
}

// Chains > 1 hop slow first paint; > 5 chains is a structural pattern.
export function classifyChains(count: number): Severity {
  if (count === 0) return 'good';
  if (count > 5) return 'warn';
  return 'neutral';
}

export function classifyLoops(count: number): Severity {
  return count === 0 ? 'good' : 'bad';
}

export function classifyDowngrades(count: number): Severity {
  return count === 0 ? 'good' : 'bad';
}

// ============================================================
//  MODULE-OVERVIEW GRID LAYOUT
// ============================================================
// Adaptive grid for the module gauges. Returns rows of indices and a
// flag indicating whether the LAST row should be horizontally centered
// (to avoid a "missing slot" look when the row is shorter).
//
//   1-3 modules → single row, left-aligned
//   4 modules   → single row of 4
//   5 modules   → 3 + 2, last centered
//   6 modules   → 3 + 3
//   7 modules   → 4 + 3, last centered
//   8 modules   → 4 + 4
//   >8 modules  → 4-wide rows, last centered if shorter
export interface ModuleGridLayout {
  rows: number[][];
  centerLast: boolean;
}

export function moduleGridLayout(count: number): ModuleGridLayout {
  if (count <= 0) return { rows: [], centerLast: false };
  if (count <= 4) {
    return { rows: [Array.from({ length: count }, (_, i) => i)], centerLast: false };
  }
  if (count === 5) return { rows: [[0, 1, 2], [3, 4]],            centerLast: true };
  if (count === 6) return { rows: [[0, 1, 2], [3, 4, 5]],         centerLast: false };
  if (count === 7) return { rows: [[0, 1, 2, 3], [4, 5, 6]],      centerLast: true };
  if (count === 8) return { rows: [[0, 1, 2, 3], [4, 5, 6, 7]],   centerLast: false };
  // Fallback for >8: 4-wide rows, center last if shorter
  const rows: number[][] = [];
  for (let i = 0; i < count; i += 4) {
    rows.push(Array.from({ length: Math.min(4, count - i) }, (_, k) => i + k));
  }
  return { rows, centerLast: rows[rows.length - 1].length < 4 };
}
