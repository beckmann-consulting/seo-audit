// ultimate-41, point 13 (journal ultimate-41-plan.md section 5): a target keyword per page, given with the audit, and
// where it occurs: title, H1, meta description, URL. Without input the point is not configured.
import type { Finding, PageSEOData, TargetKeyword } from '@/types';
import { id } from '@/lib/findings/utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import type { CheckLog } from './check-log';

export const MAX_ENTRIES = 50;
export const MAX_KEYWORD = 80;
export const MAX_URL = 2000;

/** The form field: one line per page, "URL or path = keyword"; empty lines are skipped. */
export function parseTargetKeywords(text: string): { entries: TargetKeyword[]; error?: { line: number; de: string; en: string } } {
  const entries: TargetKeyword[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const at = line.indexOf('=');
    const url = at > 0 ? line.slice(0, at).trim() : '';
    const keyword = at > 0 ? line.slice(at + 1).trim() : '';
    const problem = checkEntry({ url, keyword });
    if (problem) return { entries, error: { line: i + 1, ...problem } };
    entries.push({ url, keyword });
    if (entries.length > MAX_ENTRIES) return { entries, error: { line: i + 1, de: `Höchstens ${MAX_ENTRIES} Zeilen.`, en: `At most ${MAX_ENTRIES} lines.` } };
  }
  return { entries };
}

function checkEntry(e: { url: unknown; keyword: unknown }): { de: string; en: string } | undefined {
  if (typeof e.url !== 'string' || typeof e.keyword !== 'string' || !e.url.trim() || !e.keyword.trim()) {
    return { de: 'Erwartet: URL oder Pfad = Keyword.', en: 'Expected: URL or path = keyword.' };
  }
  if (e.keyword.trim().length > MAX_KEYWORD) return { de: `Keyword länger als ${MAX_KEYWORD} Zeichen.`, en: `Keyword longer than ${MAX_KEYWORD} characters.` };
  if (e.url.length > MAX_URL) return { de: 'URL zu lang.', en: 'URL too long.' };
  const u = e.url.trim();
  if (!u.startsWith('/')) {
    try { const p = new URL(u); if (!/^https?:$/.test(p.protocol)) throw new Error(); } catch { return { de: `Kein Pfad und keine http(s)-URL: ${u}`, en: `Neither a path nor an http(s) URL: ${u}` }; }
  }
  return undefined;
}

/** The request body (route.ts, before the stream opens): undefined is fine, anything else must be well-formed. */
export function validateTargetKeywords(v: unknown): { ok: true; value?: TargetKeyword[] } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true };
  if (!Array.isArray(v)) return { ok: false, error: 'targetKeywords must be a list of { url, keyword }' };
  if (v.length > MAX_ENTRIES) return { ok: false, error: `targetKeywords: at most ${MAX_ENTRIES} entries` };
  const out: TargetKeyword[] = [];
  for (const e of v) {
    if (!e || typeof e !== 'object') return { ok: false, error: 'targetKeywords: every entry needs url and keyword' };
    const problem = checkEntry(e as { url: unknown; keyword: unknown });
    if (problem) return { ok: false, error: `targetKeywords: ${problem.en}` };
    out.push({ url: (e as TargetKeyword).url.trim(), keyword: (e as TargetKeyword).keyword.trim() });
  }
  return { ok: true, value: out };
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase();
const translit = (s: string) => s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const keywordWords = (k: string) => fold(k).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Where the keyword is missing: every word of it must occur (a phrase may be split). */
export function missingPlaces(p: PageSEOData, keyword: string): string[] {
  const ws = keywordWords(keyword);
  const has = (text: string | undefined) => { const t = fold(text ?? ''); return ws.every(w => t.includes(w)); };
  let path = '';
  try { path = decodeURIComponent(new URL(p.url).pathname); } catch { path = p.url; }
  const urlText = fold(path);
  const inUrl = ws.every(w => urlText.includes(w) || urlText.includes(translit(w)));
  const missing: string[] = [];
  if (!has(p.title)) missing.push('Title');
  if (!(p.h1s ?? []).some(h => has(h))) missing.push('H1');
  if (!has(p.metaDescription)) missing.push('Description');
  if (!inUrl) missing.push('URL');
  return missing;
}

function findPage(pages: PageSEOData[], target: string): PageSEOData | undefined {
  if (target.startsWith('/')) {
    const want = target.length > 1 ? target.replace(/\/+$/, '') : '/';
    return pages.find(p => { try { const path = new URL(p.url).pathname; return (path.length > 1 ? path.replace(/\/+$/, '') : '/') === want; } catch { return false; } });
  }
  const n = normaliseUrl(target);
  return pages.find(p => normaliseUrl(p.url) === n || p.redirectChain.some(r => normaliseUrl(r) === n));
}

export function generateTargetKeywordFindings(pages: PageSEOData[], keywords: TargetKeyword[] | undefined, log?: CheckLog): Finding[] {
  if (!keywords || keywords.length === 0) {
    log?.record('target-keyword', { status: 'not-configured', summary_de: 'Keine Ziel-Keywords angegeben.', summary_en: 'No target keywords given.' });
    return [];
  }
  const findings: Finding[] = [];
  const notCrawled: string[] = [];
  const ok: string[] = [];
  for (const k of keywords) {
    const p = findPage(pages, k.url);
    if (!p) { notCrawled.push(k.url); continue; }
    const missing = missingPlaces(p, k.keyword);
    if (missing.length === 0) { ok.push(p.url); continue; }
    findings.push({
      id: id(), code: 'seo.target-keyword-missing', priority: 'recommended', module: 'seo', effort: 'low', impact: 'medium', affectedUrl: p.url,
      title_de: `Ziel-Keyword „${k.keyword}“ fehlt in ${missing.join(', ')}`,
      title_en: `Target keyword "${k.keyword}" missing in ${missing.join(', ')}`,
      description_de: `Auf ${p.url} kommt das Ziel-Keyword nicht (mit allen Wörtern) vor in: ${missing.join(', ')}.`,
      description_en: `On ${p.url} the target keyword does not occur (with all its words) in: ${missing.join(', ')}.`,
      recommendation_de: 'Das Keyword natürlich in Title, H1 und Description aufnehmen; die URL nur bei neuen Seiten anpassen (sonst Weiterleitung nötig).',
      recommendation_en: 'Work the keyword naturally into title, H1 and description; change the URL only for new pages (otherwise a redirect is needed).',
    });
  }
  const notCrawledNote_de = notCrawled.length ? ` Nicht gecrawlt: ${notCrawled.slice(0, 5).join(', ')}.` : '';
  const notCrawledNote_en = notCrawled.length ? ` Not crawled: ${notCrawled.slice(0, 5).join(', ')}.` : '';
  log?.record('target-keyword', findings.length > 0
    ? { status: 'fail', findings, summary_de: `${keywords.length} Ziel-Keyword(s): ${ok.length} vollständig, ${findings.length} mit Lücken.${notCrawledNote_de}`, summary_en: `${keywords.length} target keyword(s): ${ok.length} complete, ${findings.length} with gaps.${notCrawledNote_en}` }
    : ok.length === 0
      ? { status: 'not-checkable', summary_de: `Keine der angegebenen Seiten wurde gecrawlt.${notCrawledNote_de}`, summary_en: `None of the given pages was crawled.${notCrawledNote_en}` }
      : notCrawled.length > 0
        ? { status: 'not-checkable', summary_de: `${ok.length} vollständig, aber nicht alle Seiten gecrawlt.${notCrawledNote_de}`, summary_en: `${ok.length} complete, but not every page crawled.${notCrawledNote_en}` }
        : { status: 'pass', summary_de: `${ok.length} Ziel-Keyword(s) in Title, H1, Description und URL.`, summary_en: `${ok.length} target keyword(s) in title, H1, description and URL.` });
  return findings;
}
