// Types of the AI visibility module (ultimate-40): seven checks, each with a
// status, and the data the UI and the PDF show beside the findings.

import type { Module, Priority } from '@/types';

export type AICheckId = 'crawlers' | 'snippets' | 'llms' | 'structured' | 'nojs' | 'answers' | 'trust';

// pass / fail are assessable; not-checkable and info never count for the score.
export type AICheckStatus = 'pass' | 'fail' | 'not-checkable' | 'info';

// A failed check whose finding another module owns (the ownership table of
// the plan): it counts for the AI score only, as a shadow entry, never as a
// finding of its own.
export interface AIShadowEntry {
  signal: string;
  owner: Module;
  priority: Priority;
}

export interface AICheckResult {
  id: AICheckId;
  status: AICheckStatus;
  heuristic?: boolean;
  summary_de: string;
  summary_en: string;
  details_de: string[];
  details_en: string[];
  shadow: AIShadowEntry[];
}

export type AICrawlerPurpose = 'training' | 'search' | 'user' | 'mixed' | 'unknown';
export type AICrawlerRobots = 'honored' | 'may-ignore' | 'ignored' | 'unknown';

export interface AICrawlerEntry {
  token: string;
  vendor: string;
  purpose: AICrawlerPurpose;
  robotsTxt: AICrawlerRobots;
  controls_de: string;
  controls_en: string;
  source: string | null;
  sourceStatus: 'official' | 'none-found';
  checked: string; // YYYY-MM-DD
  status: 'active' | 'legacy';
}

export interface AIBotRow {
  token: string;
  vendor: string;
  purpose: AICrawlerPurpose;
  robotsTxt: AICrawlerRobots;
  status: 'allowed' | 'partial' | 'blocked';
  group: 'own' | 'wildcard' | 'none';
  scoreRelevant: boolean;
  source: string | null;
  checked: string;
  legacy: boolean;
}

export type RobotsFetchStatus = 'ok' | 'not-found' | 'server-error' | 'network-error';

export interface RobotsFetch {
  status: RobotsFetchStatus;
  httpStatus?: number;
  content?: string;
  error?: string;
}

export type LlmsTxtStatus = 'present-readable' | 'present-unreadable' | 'absent' | 'error';

export interface LlmsTxtInfo {
  status: LlmsTxtStatus;
  url: string;
  httpStatus?: number;
  reason?: string;
  hasFullTxt?: boolean;
}

export interface AIRenderPageResult {
  url: string;
  source: 'browserless' | 'local';
  // assessed: compared; incomplete: not assessable (reason says why)
  state: 'assessed' | 'incomplete';
  reason?: string;
  staticWords: number;
  renderedWords: number;
  missingHeadings: string[];
  headDiffs: string[];
}

export interface AIVisibilityInfo {
  checks: AICheckResult[];
  bots: AIBotRow[];
  robots: { status: RobotsFetchStatus; httpStatus?: number };
  llms: LlmsTxtInfo;
  render: { source: 'browserless' | 'local' | 'none'; pages: AIRenderPageResult[]; note_de?: string; note_en?: string };
  coverage: { assessable: number; total: number };
  // undefined when no check is assessable: the module then has no score
  score?: number;
}
