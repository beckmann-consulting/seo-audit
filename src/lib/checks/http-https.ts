// ultimate-41, point 3: the http:// variant of the start page and up to three subpages must answer with one 301 to
// the HTTPS URL, which answers 200. Journal ultimate-41-plan.md section 3, B3. The order asks for a one-step 301;
// a 308 is permanent too and Google treats both alike, but here it does not pass (own optional finding).
import type { Finding, PageSEOData } from '@/types';
import { id } from '@/lib/findings/utils';
import type { CheckOutcome } from './check-log';
import { probeChain, type ProbeOptions, type ProbeResult } from './probe';

export const HTTP_SUBPAGES = 3;

export interface HttpHttpsInput extends Omit<ProbeOptions, 'follow'> {
  pages: PageSEOData[]; // crawled pages; the first with depth 0 is the start page
}

export interface HttpCheck {
  pageUrl: string; // the crawled https URL
  httpUrl: string;
  result: ProbeResult;
  problems: string[]; // finding codes for this URL
  complete: boolean;
}

function norm(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    if (x.pathname !== '/' && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1);
    return x.href;
  } catch { return u; }
}

/** The start page and up to three subpages answered 200, by click depth, then alphabetically. */
export function pickUrls(pages: PageSEOData[]): string[] {
  const ok = pages.filter(p => p.httpStatus === 200 && /^https:/i.test(p.url));
  const start = ok.find(p => p.depth === 0) ?? ok[0];
  if (!start) return [];
  const rest = ok.filter(p => p !== start).sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const seen = new Set([norm(start.url)]);
  const out = [start.url];
  for (const p of rest) {
    if (out.length > HTTP_SUBPAGES) break;
    if (seen.has(norm(p.url))) continue;
    seen.add(norm(p.url));
    out.push(p.url);
  }
  return out;
}

/**
 * The problems of one http URL. `complete` is false when the chain could not be followed to its end (no answer, the
 * budget ran out, a step was refused or failed): then only what the answered steps show counts, and the URL makes
 * the point not checkable unless a finding stands anyway.
 */
function evaluate(pageUrl: string, r: ProbeResult): { problems: string[]; complete: boolean } {
  const s = r.steps;
  if (s.length === 0) return { problems: [], complete: false };
  const first = s[0];
  if (first.status >= 200 && first.status < 300) return { problems: ['tech.http-no-redirect'], complete: true };
  if (!(first.status >= 300 && first.status < 400)) return { problems: ['tech.http-redirect-wrong-target'], complete: true };
  const problems: string[] = [];
  if (first.status === 308) problems.push('tech.http-redirect-308');
  else if (first.status !== 301) problems.push('tech.http-redirect-temporary');
  if (r.stopped === 'deadline' || r.stopped === 'error' || r.stopped === 'refused') return { problems, complete: false };
  if (r.stopped === 'outside') return { problems: [...problems, 'tech.http-redirect-wrong-target'], complete: true };
  if (r.stopped === 'max-hops') return { problems: [...problems, 'tech.http-redirect-chain', 'tech.http-redirect-wrong-target'], complete: true };
  const last = s[s.length - 1];
  if (s.length > 2) problems.push('tech.http-redirect-chain');
  const rightTarget = last.status === 200 && /^https:/i.test(last.url) && norm(last.url) === norm(pageUrl);
  if (!rightTarget) problems.push('tech.http-redirect-wrong-target');
  return { problems, complete: true };
}

const TEXTS: Record<string, { priority: Finding['priority']; title_de: string; title_en: string; description_de: string; description_en: string; recommendation_de: string; recommendation_en: string }> = {
  'tech.http-no-redirect': {
    priority: 'important',
    title_de: 'HTTP ohne Weiterleitung auf HTTPS',
    title_en: 'HTTP without a redirect to HTTPS',
    description_de: 'Die http-Variante liefert Inhalt aus, statt auf HTTPS weiterzuleiten. So entstehen doppelte Inhalte und unverschlüsselte Aufrufe.',
    description_en: 'The http variant serves content instead of redirecting to HTTPS. This creates duplicate content and unencrypted visits.',
    recommendation_de: 'Jede http-URL mit einer 301 auf dieselbe HTTPS-URL weiterleiten.',
    recommendation_en: 'Redirect every http URL with a 301 to the same HTTPS URL.',
  },
  'tech.http-redirect-temporary': {
    priority: 'recommended',
    title_de: 'HTTP leitet nur vorübergehend auf HTTPS weiter',
    title_en: 'HTTP redirects to HTTPS only temporarily',
    description_de: 'Die erste Weiterleitung ist 302, 303 oder 307. Suchmaschinen behandeln die http-URL dann womöglich weiter als eigene Adresse.',
    description_en: 'The first redirect is a 302, 303 or 307. Search engines may then keep the http URL as an address of its own.',
    recommendation_de: 'Die Weiterleitung von http auf https dauerhaft machen (301).',
    recommendation_en: 'Make the http to https redirect permanent (301).',
  },
  'tech.http-redirect-308': {
    priority: 'optional',
    title_de: 'HTTP leitet mit 308 statt 301 auf HTTPS weiter',
    title_en: 'HTTP redirects to HTTPS with 308 instead of 301',
    description_de: '308 ist wie 301 dauerhaft, und Google behandelt beide gleich; verlangt ist hier eine einstufige 301.',
    description_en: '308 is permanent like 301, and Google treats both alike; required here is a one-step 301.',
    recommendation_de: 'Für die Weiterleitung von http auf https 301 senden.',
    recommendation_en: 'Send 301 for the http to https redirect.',
  },
  'tech.http-redirect-chain': {
    priority: 'recommended',
    title_de: 'Weiterleitungskette von HTTP auf HTTPS',
    title_en: 'Redirect chain from HTTP to HTTPS',
    description_de: 'Bis zur Antwort 200 braucht es mehr als eine Weiterleitung (z. B. http → https → www).',
    description_en: 'It takes more than one redirect to reach the 200 answer (e.g. http → https → www).',
    recommendation_de: 'Direkt in einem Schritt auf die endgültige HTTPS-URL weiterleiten.',
    recommendation_en: 'Redirect in one step to the final HTTPS URL.',
  },
  'tech.http-redirect-wrong-target': {
    priority: 'recommended',
    title_de: 'HTTP leitet nicht auf dieselbe HTTPS-Seite weiter',
    title_en: 'HTTP does not redirect to the same HTTPS page',
    description_de: 'Das Ziel ist nicht HTTPS, eine andere Seite (z. B. die Startseite), eine andere Domain, oder es antwortet nicht mit 200.',
    description_en: 'The target is not HTTPS, another page (e.g. the start page), another domain, or it does not answer 200.',
    recommendation_de: 'Jede http-URL auf genau ihre HTTPS-Entsprechung weiterleiten.',
    recommendation_en: 'Redirect every http URL to exactly its HTTPS counterpart.',
  },
};

export async function checkHttpToHttps(i: HttpHttpsInput): Promise<{ findings: Finding[]; outcome: CheckOutcome; checks: HttpCheck[] }> {
  const { pages, ...probe } = i;
  const checks: HttpCheck[] = [];
  for (const pageUrl of pickUrls(pages)) {
    const u = new URL(pageUrl);
    u.protocol = 'http:';
    const result = await probeChain(u.href, { ...probe, follow: 'site' });
    checks.push({ pageUrl, httpUrl: u.href, result, ...evaluate(pageUrl, result) });
  }
  const findings: Finding[] = [];
  for (const code of Object.keys(TEXTS)) {
    const hit = checks.filter(c => c.problems.includes(code));
    if (hit.length === 0) continue;
    const t = TEXTS[code];
    const chains = hit.slice(0, 5).map(c => `${c.httpUrl}: ${c.result.steps.map(s => s.status).join(' → ')}${c.result.outsideUrl ? ` → ${c.result.outsideUrl}` : ''}`).join('; ');
    findings.push({
      id: id(), code, priority: t.priority, module: 'tech', effort: 'low', impact: t.priority === 'important' ? 'high' : 'medium',
      affectedUrl: hit[0].httpUrl,
      title_de: t.title_de, title_en: t.title_en,
      description_de: `${t.description_de} Betroffen (${hit.length}): ${chains}.`,
      description_en: `${t.description_en} Affected (${hit.length}): ${chains}.`,
      recommendation_de: t.recommendation_de, recommendation_en: t.recommendation_en,
    });
  }
  const unchecked = checks.filter(c => !c.complete);
  let outcome: CheckOutcome;
  if (checks.length === 0) {
    outcome = { status: 'not-applicable', summary_de: 'Keine gecrawlte HTTPS-Seite mit Status 200.', summary_en: 'No crawled HTTPS page with status 200.' };
  } else if (findings.length > 0) {
    outcome = { status: 'fail', findings, summary_de: `${findings.length} Befund(e) bei ${checks.length} geprüften http-URLs.`, summary_en: `${findings.length} finding(s) for ${checks.length} http URLs checked.` };
  } else if (unchecked.length > 0) {
    const why = unchecked.map(c => `${c.httpUrl} (${c.result.reason ?? c.result.stopped})`).slice(0, 3).join(', ');
    outcome = { status: 'not-checkable', summary_de: `${checks.length - unchecked.length} von ${checks.length} http-URLs ganz geprüft; nicht bis zum Ende: ${why}.`, summary_en: `${checks.length - unchecked.length} of ${checks.length} http URLs fully checked; not to the end: ${why}.` };
  } else {
    outcome = { status: 'pass', summary_de: `${checks.length} http-URL(s): je eine 301 auf dieselbe HTTPS-Seite mit 200.`, summary_en: `${checks.length} http URL(s): one 301 each to the same HTTPS page answering 200.` };
  }
  return { findings, outcome, checks };
}
