// Shared helpers of the seven checks.

import { id } from '@/lib/findings/utils';
import type { Finding, Priority, Effort, Impact } from '@/types';
import type { AICheckId, AICheckResult, AICheckStatus, AIShadowEntry } from '../types';

export function result(
  idOf: AICheckId,
  status: AICheckStatus,
  summary_de: string,
  summary_en: string,
  extra: { details_de?: string[]; details_en?: string[]; shadow?: AIShadowEntry[]; heuristic?: boolean } = {},
): AICheckResult {
  return {
    id: idOf,
    status,
    summary_de,
    summary_en,
    details_de: extra.details_de ?? [],
    details_en: extra.details_en ?? [],
    shadow: extra.shadow ?? [],
    ...(extra.heuristic ? { heuristic: true } : {}),
  };
}

export function finding(
  priority: Priority,
  effort: Effort,
  impact: Impact,
  t: { title_de: string; title_en: string; description_de: string; description_en: string; recommendation_de: string; recommendation_en: string },
  affectedUrl?: string,
): Finding {
  return { id: id(), priority, module: 'ai', effort, impact, ...t, ...(affectedUrl ? { affectedUrl } : {}) };
}

export interface CheckOutput {
  result: AICheckResult;
  findings: Finding[];
}

export function sample(urls: string[], n = 5): string {
  return urls.slice(0, n).join(', ') + (urls.length > n ? ` (+${urls.length - n})` : '');
}
