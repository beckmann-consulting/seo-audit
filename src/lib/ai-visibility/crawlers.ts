// The AI crawler data file and the rule for which entries count for the score.

import data from './crawlers.json';
import type { AICrawlerEntry } from './types';

export const AI_CRAWLERS: AICrawlerEntry[] = (data as { crawlers: AICrawlerEntry[] }).crawlers;

/**
 * Only a crawler that serves search, whose vendor documents that it honours
 * robots.txt, with an official source and still active, counts for the score
 * of check 1. Training bots, user-triggered fetchers (which may ignore
 * robots.txt), undocumented and legacy tokens are shown only.
 */
export function isScoreRelevant(c: AICrawlerEntry): boolean {
  return c.status === 'active' && c.purpose === 'search' && c.robotsTxt === 'honored' && c.sourceStatus === 'official';
}
