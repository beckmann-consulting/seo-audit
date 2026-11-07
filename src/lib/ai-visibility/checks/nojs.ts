// Check 5: readable without JavaScript. Static HTML against the rendered DOM:
// main text, H1 to H3 and the head (title, canonical, hreflang, lang; point
// 15). The empty shell and "JavaScript rendering required" by word count
// belong to tech when tech is active; headings and head are always ai's.
// A local render that was not complete is never assessed, only noted.

import { contentSignals } from '../signals';
import { jsRenderingRequiredSeverity } from '@/lib/findings/tech';
import type { AIRenderPageResult, AIShadowEntry, AIVisibilityInfo } from '../types';
import type { Module, PageSEOData } from '@/types';
import { result, finding, sample, type CheckOutput } from './common';

export const MAIN_TEXT_FAIL_RATIO = 0.5;
export const MAIN_TEXT_PASS_RATIO = 0.8;
export const MAIN_TEXT_MIN_RENDERED = 50; // below this the page is too thin to judge

export interface RenderedPage {
  url: string;
  staticHtml: string;
  renderedHtml?: string;
  source?: 'browserless' | 'local';
  incompleteReason?: string;
  seo: PageSEOData;
}


export function comparePage(p: RenderedPage): AIRenderPageResult {
  const s = contentSignals(p.staticHtml, p.url);
  const r = contentSignals(p.renderedHtml ?? '', p.url);
  const staticHeadings = new Set(s.headings.map(h => h.toLowerCase()));
  const missingHeadings = r.headings.filter(h => !staticHeadings.has(h.toLowerCase())); // H1 to H3
  const headDiffs: string[] = [];
  if (s.head.title !== r.head.title) headDiffs.push(`title: "${s.head.title}" → "${r.head.title}"`);
  if (s.head.canonical !== r.head.canonical) headDiffs.push(`canonical: ${s.head.canonical || 'none'} → ${r.head.canonical || 'none'}`);
  if (s.head.hreflang.join(' ') !== r.head.hreflang.join(' ')) headDiffs.push(`hreflang: ${s.head.hreflang.length} → ${r.head.hreflang.length}`);
  if (s.head.lang !== r.head.lang) headDiffs.push(`lang: ${s.head.lang || 'none'} → ${r.head.lang || 'none'}`);
  return {
    url: p.url, source: p.source ?? 'browserless', state: 'assessed',
    staticWords: s.mainWords, renderedWords: r.mainWords, missingHeadings, headDiffs,
  };
}

export function checkNoJs(pages: RenderedPage[], modules: Module[]): CheckOutput & { render: AIVisibilityInfo['render'] } {
  const techActive = modules.includes('tech');
  const results: AIRenderPageResult[] = [];
  const textOnlyRendered: string[] = [];
  const partlyRendered: string[] = [];
  const headDiff: string[] = [];
  const shells: string[] = [];
  const shadow: AIShadowEntry[] = [];
  const notes_de: string[] = [];
  const notes_en: string[] = [];
  let assessed = 0;
  let source: AIVisibilityInfo['render']['source'] = 'none';

  for (const p of pages) {
    if (p.renderedHtml === undefined && !p.incompleteReason) {
      // no render: only an empty shell can be judged (it fails without a render)
      if (p.seo.likelyClientRendered) {
        assessed++;
        if (techActive) shadow.push({ signal: 'csr-shell', owner: 'tech', priority: 'important' });
        else shells.push(p.url);
      }
      continue;
    }
    source = p.source ?? 'browserless';
    if (p.incompleteReason) {
      const partial = p.renderedHtml !== undefined ? comparePage(p) : undefined;
      results.push({ url: p.url, source: p.source ?? 'local', state: 'incomplete', reason: p.incompleteReason,
        staticWords: partial?.staticWords ?? 0, renderedWords: partial?.renderedWords ?? 0, missingHeadings: [], headDiffs: [] });
      notes_de.push(`${p.url}: nicht gewertet (${p.incompleteReason})${partial ? `; Teilvergleich, unbewertet: statisch ${partial.staticWords} Wörter, gerendert ${partial.renderedWords}` : ''}`);
      notes_en.push(`${p.url}: not assessed (${p.incompleteReason})${partial ? `; partial comparison, unscored: static ${partial.staticWords} words, rendered ${partial.renderedWords}` : ''}`);
      continue;
    }
    const c = comparePage(p);
    results.push(c);
    assessed++;
    // three tiers: under MAIN_TEXT_FAIL_RATIO of the rendered main text (or an H1/H2 only rendered) is
    // important; from there to MAIN_TEXT_PASS_RATIO (or an H3 only rendered) is a lower failure; at least
    // MAIN_TEXT_PASS_RATIO with every heading present passes
    const thick = c.renderedWords >= MAIN_TEXT_MIN_RENDERED;
    const textMissing = thick && c.staticWords < MAIN_TEXT_FAIL_RATIO * c.renderedWords;
    const textPartly = thick && !textMissing && c.staticWords < MAIN_TEXT_PASS_RATIO * c.renderedWords;
    const major = c.missingHeadings.filter(h => /^h[12]: /.test(h));
    const minor = c.missingHeadings.filter(h => /^h3: /.test(h));
    const techOwns = techActive && jsRenderingRequiredSeverity(p.seo) !== null;
    if (textMissing && techOwns) shadow.push({ signal: 'js-required', owner: 'tech', priority: 'important' });
    const label = `${p.url} (${c.staticWords}/${c.renderedWords}${c.missingHeadings.length ? `, ${c.missingHeadings.slice(0, 2).join('; ')}` : ''})`;
    if ((textMissing && !techOwns) || major.length > 0) textOnlyRendered.push(label);
    else if (textPartly || minor.length > 0) partlyRendered.push(label);
    if (c.headDiffs.length > 0) headDiff.push(`${p.url} (${c.headDiffs.join('; ')})`);
  }

  const render = { source, pages: results,
    ...(source === 'local' ? { note_de: 'Lokal gerendert, ohne fremde Domains (Subdomains derselben Domain sind erlaubt); Seiten mit Ressourcen anderer Domains sind so nicht wertbar (dafür Browserless).', note_en: 'Rendered locally without other domains (subdomains of the same domain are allowed); pages with resources of other domains cannot be assessed this way (Browserless can).' } : {}) };
  if (assessed === 0) {
    const why_de = results.length > 0 ? 'Kein Render war vollständig.' : 'Kein gerenderter DOM: weder Browserless noch ein lokales Chromium (AI_LOCAL_CHROMIUM).';
    const why_en = results.length > 0 ? 'No render was complete.' : 'No rendered DOM: neither Browserless nor a local Chromium (AI_LOCAL_CHROMIUM).';
    return { render, findings: [], result: result('nojs', 'not-checkable', why_de, why_en, { details_de: notes_de, details_en: notes_en }) };
  }
  const findings = [];
  if (shells.length > 0) {
    findings.push(finding('important', 'high', 'high', {
      title_de: `Seite ohne JavaScript leer: ${shells.length}`,
      title_en: `Page empty without JavaScript: ${shells.length}`,
      description_de: `Das statische HTML ist eine leere Hülle; KI-Crawler, die kein JavaScript ausführen, sehen keinen Inhalt. Betroffen: ${sample(shells)}`,
      description_en: `The static HTML is an empty shell; AI crawlers that do not run JavaScript see no content. Affected: ${sample(shells)}`,
      recommendation_de: 'Inhalte serverseitig rendern oder vorrendern.',
      recommendation_en: 'Render the content on the server or prerender it.',
    }));
  }
  if (textOnlyRendered.length > 0) {
    findings.push(finding('important', 'high', 'high', {
      title_de: `Haupttext oder Überschriften nur nach JavaScript vorhanden: ${textOnlyRendered.length} Seite(n)`,
      title_en: `Main text or headings only present after JavaScript: ${textOnlyRendered.length} page(s)`,
      description_de: `Viele KI-Crawler führen kein JavaScript aus und lesen nur das statische HTML. Beispiele (statische/gerenderte Wörter): ${sample(textOnlyRendered, 3)}`,
      description_en: `Many AI crawlers do not run JavaScript and only read the static HTML. Examples (static/rendered words): ${sample(textOnlyRendered, 3)}`,
      recommendation_de: 'Haupttext und Überschriften im ausgelieferten HTML mitsenden (Server-Rendering oder Vorrendern).',
      recommendation_en: 'Ship main text and headings in the delivered HTML (server rendering or prerendering).',
    }));
  }
  if (partlyRendered.length > 0) {
    findings.push(finding('recommended', 'medium', 'medium', {
      title_de: `Teile des Inhalts nur nach JavaScript vorhanden: ${partlyRendered.length} Seite(n)`,
      title_en: `Parts of the content only present after JavaScript: ${partlyRendered.length} page(s)`,
      description_de: `Statisch fehlt ein Teil des Haupttexts (${Math.round(MAIN_TEXT_FAIL_RATIO * 100)} bis ${Math.round(MAIN_TEXT_PASS_RATIO * 100)} % vorhanden) oder eine H3. Beispiele (statische/gerenderte Wörter): ${sample(partlyRendered, 3)}`,
      description_en: `Part of the main text (${Math.round(MAIN_TEXT_FAIL_RATIO * 100)} to ${Math.round(MAIN_TEXT_PASS_RATIO * 100)} % present) or an H3 is missing statically. Examples (static/rendered words): ${sample(partlyRendered, 3)}`,
      recommendation_de: 'Auch nachgeladene Abschnitte im ausgelieferten HTML mitsenden.',
      recommendation_en: 'Ship sections that load later in the delivered HTML too.',
    }));
  }
  if (headDiff.length > 0) {
    findings.push(finding('recommended', 'medium', 'medium', {
      title_de: `Kopf ändert sich nach JavaScript: ${headDiff.length} Seite(n)`,
      title_en: `Head changes after JavaScript: ${headDiff.length} page(s)`,
      description_de: `title, canonical, hreflang oder lang sind statisch anders als gerendert; Crawler ohne JavaScript lesen die statischen Werte. Beispiele: ${sample(headDiff, 3)}`,
      description_en: `title, canonical, hreflang or lang differ between static and rendered; crawlers without JavaScript read the static values. Examples: ${sample(headDiff, 3)}`,
      recommendation_de: 'Die endgültigen Werte schon im ausgelieferten HTML setzen.',
      recommendation_en: 'Set the final values in the delivered HTML already.',
    }));
  }
  const failed = findings.length > 0 || shadow.length > 0;
  return {
    render,
    findings,
    result: result('nojs', failed ? 'fail' : 'pass',
      failed ? `Ohne JavaScript fehlt Inhalt (${assessed} Seite(n) gewertet).` : `Haupttext, Überschriften und Kopf ohne JavaScript vorhanden (${assessed} Seite(n) gewertet).`,
      failed ? `Content missing without JavaScript (${assessed} page(s) assessed).` : `Main text, headings and head present without JavaScript (${assessed} page(s) assessed).`,
      { details_de: notes_de, details_en: notes_en, shadow }),
  };
}
