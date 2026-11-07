// Check 2: snippet controls. nosnippet or max-snippet:0 (for all bots or for
// Googlebot) keep the text out of AI Overviews and AI Mode; a small
// max-snippet is a heuristic; data-nosnippet only counts on div, span and
// section, as Google supports it.

import { snippetSignals } from '../signals';
import { result, finding, sample, type CheckOutput } from './common';

export const MAX_SNIPPET_HEURISTIC = 50; // our estimate, Google names no minimum
export const DATA_NOSNIPPET_SHARE = 0.5;

export interface SnippetPage { url: string; html: string; xRobotsTag?: string }

export function checkSnippets(pages: SnippetPage[]): CheckOutput {
  const withHtml = pages.filter(p => p.html && p.html.trim());
  if (withHtml.length === 0) {
    return { findings: [], result: result('snippets', 'not-checkable', 'Keine Seite mit HTML zum Prüfen.', 'No page with HTML to check.') };
  }
  const blocked: string[] = [];
  const small: { url: string; n: number }[] = [];
  const hidden: { url: string; share: number }[] = [];
  for (const p of withHtml) {
    const s = snippetSignals(p.html, p.xRobotsTag);
    if (s.nosnippet) blocked.push(`${p.url} (${s.nosnippetSource.join(', ')})`);
    else if (s.maxSnippet !== undefined && s.maxSnippet < MAX_SNIPPET_HEURISTIC) small.push({ url: p.url, n: s.maxSnippet });
    if (s.dataNosnippetShare > DATA_NOSNIPPET_SHARE) hidden.push({ url: p.url, share: s.dataNosnippetShare });
  }
  const findings = [];
  if (blocked.length > 0) {
    findings.push(finding('important', 'low', 'high', {
      title_de: `Snippet gesperrt (nosnippet oder max-snippet:0) auf ${blocked.length} Seite(n)`,
      title_en: `Snippet blocked (nosnippet or max-snippet:0) on ${blocked.length} page(s)`,
      description_de: `Mit nosnippet nutzt Google den Text nicht als Snippet und nicht als direkte Eingabe für AI Overviews und AI Mode. Betroffen: ${sample(blocked)}`,
      description_en: `With nosnippet Google uses the text neither as a snippet nor as direct input for AI Overviews and AI Mode. Affected: ${sample(blocked)}`,
      recommendation_de: 'nosnippet nur dort setzen, wo der Text bewusst nicht in Antworten erscheinen soll; für Teile der Seite reicht data-nosnippet.',
      recommendation_en: 'Use nosnippet only where the text must deliberately stay out of answers; for parts of a page data-nosnippet is enough.',
    }));
  }
  if (small.length > 0) {
    findings.push(finding('optional', 'low', 'low', {
      title_de: `Heuristik: max-snippet unter ${MAX_SNIPPET_HEURISTIC} Zeichen auf ${small.length} Seite(n)`,
      title_en: `Heuristic: max-snippet below ${MAX_SNIPPET_HEURISTIC} characters on ${small.length} page(s)`,
      description_de: `max-snippet begrenzt auch, wie viel Text Google für AI Overviews und AI Mode nutzt. Google nennt keine Mindestlänge; die Grenze von ${MAX_SNIPPET_HEURISTIC} Zeichen ist unsere Schätzung. Betroffen: ${sample(small.map(s => `${s.url} (${s.n})`))}`,
      description_en: `max-snippet also limits how much text Google uses for AI Overviews and AI Mode. Google names no minimum; the limit of ${MAX_SNIPPET_HEURISTIC} characters is our estimate. Affected: ${sample(small.map(s => `${s.url} (${s.n})`))}`,
      recommendation_de: 'max-snippet anheben oder weglassen (-1 überlässt Google die Länge).',
      recommendation_en: 'Raise max-snippet or drop it (-1 leaves the length to Google).',
    }));
  }
  if (hidden.length > 0) {
    findings.push(finding('recommended', 'low', 'medium', {
      title_de: `data-nosnippet deckt mehr als die Hälfte des Haupttexts auf ${hidden.length} Seite(n)`,
      title_en: `data-nosnippet covers more than half of the main text on ${hidden.length} page(s)`,
      description_de: `Text in data-nosnippet nutzt Google nicht als Snippet und nicht für AI Overviews. Betroffen: ${sample(hidden.map(h => `${h.url} (${Math.round(h.share * 100)} %)`))}`,
      description_en: `Text inside data-nosnippet is used neither as a snippet nor for AI Overviews. Affected: ${sample(hidden.map(h => `${h.url} (${Math.round(h.share * 100)} %)`))}`,
      recommendation_de: 'data-nosnippet auf die Teile begrenzen, die wirklich nicht zitiert werden sollen.',
      recommendation_en: 'Limit data-nosnippet to the parts that really must not be quoted.',
    }));
  }
  if (findings.length === 0) {
    return { findings, result: result('snippets', 'pass', `Keine Snippet-Sperre auf ${withHtml.length} Seite(n).`, `No snippet block on ${withHtml.length} page(s).`) };
  }
  return { findings, result: result('snippets', 'fail', `Snippet-Steuerung schränkt KI-Antworten ein (${findings.length} Befund(e)).`, `Snippet controls restrict AI answers (${findings.length} finding(s)).`) };
}
