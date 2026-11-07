// Check 6: answer friendliness, heuristics (every finding says so in its
// title): question headings, a short answer paragraph right below, lists and
// tables, an FAQ section. At most "recommended".

import { answerSignals, type AnswerSignals } from '../signals';
import { result, finding, sample, type CheckOutput } from './common';

export const CONTENT_MIN_WORDS = 300;
export const LONG_PAGE_WORDS = 800;
const LEGAL_PATH = /(impressum|imprint|legal-notice|datenschutz|privacy|agb|terms|nutzungsbedingungen|cookie)/i;

export interface AnswerPage { url: string; html: string; wordCount: number }

export function isContentPage(p: AnswerPage): boolean {
  let path = '';
  try { path = new URL(p.url).pathname; } catch { path = p.url; }
  return p.wordCount >= CONTENT_MIN_WORDS && !LEGAL_PATH.test(path);
}

export function checkAnswers(pages: AnswerPage[]): CheckOutput & { faqPages: string[] } {
  const content = pages.filter(isContentPage);
  if (content.length === 0) {
    return { faqPages: [], findings: [], result: result('answers', 'not-checkable', `Keine Inhaltsseite (ab ${CONTENT_MIN_WORDS} Wörtern).`, `No content page (from ${CONTENT_MIN_WORDS} words).`, { heuristic: true }) };
  }
  const sig: { p: AnswerPage; s: AnswerSignals }[] = content.map(p => ({ p, s: answerSignals(p.html) }));
  const faqPages = sig.filter(x => x.s.faqSection).map(x => x.p.url);
  const noQuestions = sig.filter(x => x.s.questionHeadings === 0 && !x.s.faqSection);
  const qTotal = sig.reduce((n, x) => n + x.s.questionHeadings, 0);
  const qAnswered = sig.reduce((n, x) => n + x.s.questionHeadingsWithAnswer, 0);
  const longNoStructure = sig.filter(x => x.p.wordCount >= LONG_PAGE_WORDS && x.s.lists === 0 && x.s.tables === 0);
  const findings = [];
  if (noQuestions.length * 2 >= content.length) {
    findings.push(finding('recommended', 'medium', 'medium', {
      title_de: `Heuristik: ${noQuestions.length} von ${content.length} Inhaltsseiten ohne Fragen-Überschrift und ohne FAQ`,
      title_en: `Heuristic: ${noQuestions.length} of ${content.length} content pages without a question heading and without an FAQ`,
      description_de: `KI-Antworten greifen gern Abschnitte auf, die eine Frage stellen und sie gleich beantworten. Betroffen: ${sample(noQuestions.map(x => x.p.url))}`,
      description_en: `AI answers like to pick up sections that ask a question and answer it right away. Affected: ${sample(noQuestions.map(x => x.p.url))}`,
      recommendation_de: 'Typische Fragen der Zielgruppe als H2 oder H3 formulieren und direkt darunter in 2 bis 4 Sätzen beantworten; häufige Fragen in einem FAQ-Abschnitt sammeln.',
      recommendation_en: 'Phrase typical questions of the audience as H2 or H3 and answer each in 2 to 4 sentences right below; collect frequent questions in an FAQ section.',
    }));
  }
  if (qTotal > 0 && (qTotal - qAnswered) * 2 >= qTotal) {
    findings.push(finding('optional', 'low', 'low', {
      title_de: `Heuristik: ${qTotal - qAnswered} von ${qTotal} Fragen-Überschriften ohne Antwortabsatz direkt darunter`,
      title_en: `Heuristic: ${qTotal - qAnswered} of ${qTotal} question headings without an answer paragraph right below`,
      description_de: 'Als Antwortabsatz gilt ein <p> mit 15 bis 80 Wörtern direkt nach der Überschrift.',
      description_en: 'An answer paragraph is a <p> with 15 to 80 words directly after the heading.',
      recommendation_de: 'Unter jede Fragen-Überschrift zuerst eine kurze, vollständige Antwort setzen, Einzelheiten danach.',
      recommendation_en: 'Put a short, complete answer first under every question heading, details after it.',
    }));
  }
  if (longNoStructure.length > 0) {
    findings.push(finding('optional', 'low', 'low', {
      title_de: `Heuristik: ${longNoStructure.length} lange Seite(n) ohne Liste und ohne Tabelle`,
      title_en: `Heuristic: ${longNoStructure.length} long page(s) without a list and without a table`,
      description_de: `Seiten ab ${LONG_PAGE_WORDS} Wörtern ohne Aufzählung oder Tabelle sind schwer auszugsweise zu zitieren. Betroffen: ${sample(longNoStructure.map(x => x.p.url))}`,
      description_en: `Pages from ${LONG_PAGE_WORDS} words without a list or a table are hard to quote in parts. Affected: ${sample(longNoStructure.map(x => x.p.url))}`,
      recommendation_de: 'Schritte, Merkmale und Vergleiche als Liste oder Tabelle setzen.',
      recommendation_en: 'Set steps, features and comparisons as a list or a table.',
    }));
  }
  const status = findings.length > 0 ? 'fail' : 'pass';
  return {
    faqPages,
    findings,
    result: result('answers', status,
      `${content.length} Inhaltsseite(n): ${qTotal} Fragen-Überschrift(en), ${qAnswered} mit Antwortabsatz, FAQ auf ${faqPages.length} Seite(n).`,
      `${content.length} content page(s): ${qTotal} question heading(s), ${qAnswered} with an answer paragraph, FAQ on ${faqPages.length} page(s).`,
      { heuristic: true }),
  };
}
