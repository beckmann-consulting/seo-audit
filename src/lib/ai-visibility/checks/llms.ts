// Check 3: llms.txt, a note only. No state of it is a finding, none counts
// for the score or the Top 5.

import type { LlmsTxtInfo } from '../types';
import { result, type CheckOutput } from './common';

const NOTE_DE = 'Kein großer Anbieter hat zugesagt, llms.txt auszuwerten; Pflicht ist die Datei nicht.';
const NOTE_EN = 'No major vendor has committed to reading llms.txt; the file is not required.';

export function checkLlms(info: LlmsTxtInfo): CheckOutput {
  const map: Record<LlmsTxtInfo['status'], [string, string]> = {
    'present-readable': [`llms.txt vorhanden und lesbar${info.hasFullTxt ? ', dazu llms-full.txt' : ''}.`, `llms.txt present and readable${info.hasFullTxt ? ', with llms-full.txt' : ''}.`],
    'present-unreadable': [`llms.txt antwortet, ist aber nicht lesbar (${info.reason ?? 'unbekannt'}).`, `llms.txt answers but is not readable (${info.reason ?? 'unknown'}).`],
    absent: ['Keine llms.txt.', 'No llms.txt.'],
    error: [`llms.txt nicht abrufbar (${info.reason ?? 'Fehler'}).`, `llms.txt could not be fetched (${info.reason ?? 'error'}).`],
  };
  const [de, en] = map[info.status];
  return { findings: [], result: result('llms', 'info', de, en, { details_de: [NOTE_DE], details_en: [NOTE_EN] }) };
}
