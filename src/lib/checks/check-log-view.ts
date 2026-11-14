// ultimate-41: how the check log reads in the UI and the PDF (one source for both).
import type { CheckLogEntry, CheckStatus, Lang } from '@/types';
import type { Severity } from '@/lib/util/severity-classifier';

export const STATUS_LABELS: Record<CheckStatus, { de: string; en: string }> = {
  pass: { de: 'erfüllt', en: 'passed' },
  fail: { de: 'Befund', en: 'finding' },
  'not-applicable': { de: 'nicht zutreffend', en: 'not applicable' },
  'not-checkable': { de: 'nicht prüfbar', en: 'not checkable' },
  'not-configured': { de: 'nicht eingerichtet', en: 'not configured' },
  'not-selected': { de: 'Modul nicht gewählt', en: 'module not chosen' },
};

export const STATUS_SEVERITY: Record<CheckStatus, Severity> = {
  pass: 'good',
  fail: 'warn',
  'not-applicable': 'neutral',
  'not-checkable': 'info',
  'not-configured': 'neutral',
  'not-selected': 'neutral',
};

export interface CheckLogRow {
  point: string;
  check: string;
  status: CheckStatus;
  statusLabel: string;
  summary: string;
  codes: string; // the finding codes, comma separated, empty without findings
  severity: Severity;
}

export function checkLogRows(entries: readonly CheckLogEntry[], lang: Lang): CheckLogRow[] {
  const de = lang === 'de';
  return entries.map(e => ({
    point: e.point,
    check: e.check,
    status: e.status,
    statusLabel: de ? STATUS_LABELS[e.status].de : STATUS_LABELS[e.status].en,
    summary: de ? e.summary_de : e.summary_en,
    codes: e.findingCodes.join(', '),
    severity: STATUS_SEVERITY[e.status],
  }));
}

/** "18 checks: 12 passed, 3 with findings, 3 other" */
export function checkLogHeadline(entries: readonly CheckLogEntry[], lang: Lang): string {
  const pass = entries.filter(e => e.status === 'pass').length;
  const fail = entries.filter(e => e.status === 'fail').length;
  const other = entries.length - pass - fail;
  return lang === 'de'
    ? `${entries.length} Prüfpunkte: ${pass} erfüllt, ${fail} mit Befund, ${other} sonstige`
    : `${entries.length} check points: ${pass} passed, ${fail} with findings, ${other} other`;
}
