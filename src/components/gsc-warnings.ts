// Helper for the Search Console tab's warnings stack visibility.
//
// Pure function (no React) so the hide-rule can be unit-tested in
// isolation. Lives next to AuditApp.tsx because it's UI-state logic;
// the rule itself is documented inline since it encodes a deliberate
// design choice that's not obvious from the call site.

import type { GscResult, StreamEvent } from '@/types';

type GscWarning = Extract<StreamEvent, { type: 'warning' }>;

// Returns the list of warnings that the GSC tab should display, given
// the current ephemeral SSE warnings and the persisted gscResult.
//
// Design choice: hide the warnings stack when state === 'api-error'.
// The persistent error banner already carries the same message, and the
// GSC pipeline (G1b) only emits warnings on api-error today — rendering
// both is pure visual noise. Future GSC warnings on other states (e.g.
// partial-fetch on state='ok') would render through this helper without
// the 'api-error' branch ever short-circuiting them.
export function getVisibleGscWarnings(
  warnings: ReadonlyArray<GscWarning>,
  gscResult: GscResult | undefined,
): GscWarning[] {
  if (gscResult?.state === 'api-error') return [];
  return warnings.filter(w => w.source === 'gsc');
}
