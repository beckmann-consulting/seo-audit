// Helper for the Bing tab's warnings stack visibility.
//
// 1:1 twin of gsc-warnings.ts — same design choice (hide stack when
// state === 'api-error' so the persistent error banner doesn't get
// duplicated by an SSE warning carrying the same message). Pulled
// into its own module for unit-testability and to mirror the GSC
// shape so a future generic refactor (G3d.5) can collapse both into
// one file when there's a third search-engine provider.

import type { BingResult, StreamEvent } from '@/types';

type BingWarning = Extract<StreamEvent, { type: 'warning' }>;

// Returns the list of warnings that the Bing tab should display,
// given the current ephemeral SSE warnings and the persisted
// bingResult.
//
// Design choice: hide the warnings stack when state === 'api-error'.
// The persistent error banner already carries the same message, and
// the Bing pipeline (G3b) only emits warnings on api-error today —
// rendering both is pure visual noise. Future Bing warnings on other
// states (e.g. partial-fetch on state='ok') would render through this
// helper without the 'api-error' branch ever short-circuiting them.
export function getVisibleBingWarnings(
  warnings: ReadonlyArray<BingWarning>,
  bingResult: BingResult | undefined,
): BingWarning[] {
  if (bingResult?.state === 'api-error') return [];
  return warnings.filter(w => w.source === 'bing');
}
