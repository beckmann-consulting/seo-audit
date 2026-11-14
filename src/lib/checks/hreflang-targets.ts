// ultimate-41, point 6 (journal ultimate-41-plan.md section 4, C6): the status and canonical of every hreflang target,
// x-default and other domains included. Crawled targets come from the crawl; every other target is fetched once
// (a redirect is itself the finding and is not followed), each with its own checked and pinned scope and without
// the audit's credentials, four at a time. A fixed budget of requests and time; targets not started are counted
// and make the point not checkable, never passed.
import { parse } from 'node-html-parser';
import type { Finding, PageSEOData } from '@/types';
import { id } from '@/lib/findings/utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { parseXRobotsTag, xRobotsImpliesNoindex } from '@/lib/util/x-robots';
import type { CheckOutcome } from './check-log';
import { probeChain, type ProbeOptions } from './probe';

export const DEFAULT_MAX_REQUESTS = 300;
export const CONCURRENCY = 4;

export type TargetState =
  | { kind: 'ok'; canonical?: string; noindex: boolean }
  | { kind: 'error'; status: number }
  | { kind: 'redirect'; status: number; location?: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'not-started' };

export interface HreflangTargetsInput {
  pages: PageSEOData[];
  httpErrors: { url: string; status: number }[];
  userAgent?: string;
  transport?: ProbeOptions['transport'];
  deadline: number;
  maxRequests?: number;
}

/** The canonical (HTML link or Link header) and noindex (meta or X-Robots-Tag) of a fetched page. */
export function headSignals(body: Buffer, headers: Record<string, string>): { canonical?: string; noindex: boolean } {
  const root = parse(body.toString('utf8'));
  const linkTag = root.querySelectorAll('link[rel]').find(l => (l.getAttribute('rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  let canonical = linkTag?.getAttribute('href')?.trim() || undefined;
  if (!canonical && headers.link) {
    const m = /<([^>]+)>\s*;[^,]*rel="?canonical"?/i.exec(headers.link);
    if (m) canonical = m[1];
  }
  const meta = root.querySelectorAll('meta[name]').filter(m => /^(robots|googlebot)$/i.test(m.getAttribute('name') || ''));
  const metaNoindex = meta.some(m => /\b(noindex|none)\b/i.test(m.getAttribute('content') || ''));
  const headerNoindex = headers['x-robots-tag'] ? xRobotsImpliesNoindex(parseXRobotsTag(headers['x-robots-tag'])) : false;
  return { canonical, noindex: metaNoindex || headerNoindex };
}

export async function checkHreflangTargets(i: HreflangTargetsInput): Promise<{ findings: Finding[]; outcome: CheckOutcome; states: Map<string, TargetState>; requests: number }> {
  const pageMap = new Map<string, PageSEOData>();
  const redirectSources = new Set<string>();
  for (const p of i.pages) {
    pageMap.set(normaliseUrl(p.url), p);
    for (const src of p.redirectChain) { pageMap.set(normaliseUrl(src), p); redirectSources.add(normaliseUrl(src)); }
  }
  const errorMap = new Map(i.httpErrors.map(e => [normaliseUrl(e.url), e.status]));
  const sources = new Map<string, string[]>(); // target → pages naming it
  for (const p of i.pages) {
    for (const h of p.hreflangs) {
      let t: string;
      try { t = normaliseUrl(new URL(h.href).href); } catch { continue; }
      if (!/^https?:/i.test(t)) continue;
      sources.set(t, [...(sources.get(t) ?? []), p.url]);
    }
  }
  const states = new Map<string, TargetState>();
  const queue: string[] = [];
  for (const t of sources.keys()) {
    const err = errorMap.get(t);
    if (err !== undefined) { states.set(t, { kind: 'error', status: err }); continue; }
    if (redirectSources.has(t)) { states.set(t, { kind: 'redirect', status: 301, location: pageMap.get(t)?.url }); continue; }
    const crawled = pageMap.get(t);
    if (crawled) {
      states.set(t, { kind: 'ok', canonical: crawled.canonicalUrl, noindex: Boolean(crawled.hasNoindex || crawled.xRobotsNoindex) });
      continue;
    }
    queue.push(t);
  }

  const maxRequests = i.maxRequests ?? DEFAULT_MAX_REQUESTS;
  let requests = 0;
  const scopes = new Map();
  const worker = async () => {
    for (;;) {
      if (requests >= maxRequests || Date.now() >= i.deadline) return;
      const t = queue.shift();
      if (t === undefined) return;
      requests++;
      const r = await probeChain(t, { auditUrl: t, userAgent: i.userAgent, transport: i.transport, deadline: i.deadline, follow: 'none', maxHops: 1, scopes });
      const first = r.steps[0];
      if (!first || !r.final) { states.set(t, { kind: 'failed', reason: r.reason ?? r.stopped ?? 'no answer' }); continue; }
      if (first.status >= 300 && first.status < 400) states.set(t, { kind: 'redirect', status: first.status, location: first.location });
      else if (first.status >= 400) states.set(t, { kind: 'error', status: first.status });
      else states.set(t, { kind: 'ok', ...headSignals(r.final.body, r.final.headers) });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  for (const t of queue) states.set(t, { kind: 'not-started' });

  const errors: string[] = [];
  const redirects: string[] = [];
  const noindex: string[] = [];
  const notCanonical: string[] = [];
  let failed = 0;
  let notStarted = 0;
  for (const [t, st] of states) {
    const from = (sources.get(t) ?? [])[0];
    if (st.kind === 'error') errors.push(`${t} (${st.status}, from ${from})`);
    else if (st.kind === 'redirect') redirects.push(`${t} → ${st.location ?? '?'} (${st.status})`);
    else if (st.kind === 'failed') failed++;
    else if (st.kind === 'not-started') notStarted++;
    else {
      if (st.noindex) noindex.push(t);
      if (st.canonical) {
        let c: string;
        try { c = normaliseUrl(new URL(st.canonical, t).href); } catch { c = st.canonical; }
        if (c !== t) notCanonical.push(`${t} (canonical ${c})`);
      }
    }
  }
  const list = (xs: string[]) => xs.slice(0, 5).join('; ');
  const make = (code: string, priority: Finding['priority'], xs: string[], title_de: string, title_en: string, rec_de: string, rec_en: string): Finding => ({
    id: id(), code, priority, module: 'seo', effort: 'low', impact: priority === 'important' ? 'high' : 'medium', affectedUrl: xs[0].split(' ')[0],
    title_de, title_en, description_de: `Beispiele: ${list(xs)}.`, description_en: `Examples: ${list(xs)}.`, recommendation_de: rec_de, recommendation_en: rec_en,
  });
  const findings: Finding[] = [];
  if (errors.length) findings.push(make('seo.hreflang-target-error', 'important', errors, `${errors.length} hreflang-Ziel(e) antworten mit 4xx oder 5xx`, `${errors.length} hreflang target(s) answer 4xx or 5xx`, 'hreflang nur auf erreichbare Seiten mit Status 200 zeigen lassen.', 'Point hreflang only at reachable pages answering 200.'));
  if (redirects.length) findings.push(make('seo.hreflang-target-redirect', 'recommended', redirects, `${redirects.length} hreflang-Ziel(e) leiten weiter`, `${redirects.length} hreflang target(s) redirect`, 'hreflang auf die endgültige URL setzen, nicht auf eine Weiterleitung.', 'Set hreflang to the final URL, not to a redirect.'));
  if (noindex.length) findings.push(make('seo.hreflang-target-noindex', 'recommended', noindex, `${noindex.length} hreflang-Ziel(e) stehen auf noindex`, `${noindex.length} hreflang target(s) are noindex`, 'Nur indexierbare Seiten als Sprachversion angeben.', 'Name only indexable pages as language versions.'));
  if (notCanonical.length) findings.push(make('seo.hreflang-target-not-canonical', 'recommended', notCanonical, `${notCanonical.length} hreflang-Ziel(e) sind nicht kanonisch`, `${notCanonical.length} hreflang target(s) are not canonical`, 'hreflang auf die kanonische URL der Sprachversion setzen.', 'Set hreflang to the canonical URL of the language version.'));

  const total = states.size;
  const checked = total - failed - notStarted;
  const fromCrawl = total - requests - notStarted;
  const counts_de = `${total} Ziele: ${checked} geprüft (${fromCrawl} aus dem Crawl, ${requests} abgerufen), ${failed} gescheitert, ${notStarted} nicht gestartet.`;
  const counts_en = `${total} targets: ${checked} checked (${fromCrawl} from the crawl, ${requests} fetched), ${failed} failed, ${notStarted} not started.`;
  let outcome: CheckOutcome;
  if (total === 0) outcome = { status: 'not-applicable', summary_de: 'Keine hreflang-Angaben.', summary_en: 'No hreflang annotations.' };
  else if (findings.length > 0) outcome = { status: 'fail', findings, summary_de: counts_de, summary_en: counts_en };
  else if (failed > 0 || notStarted > 0) outcome = { status: 'not-checkable', summary_de: counts_de, summary_en: counts_en };
  else outcome = { status: 'pass', summary_de: counts_de, summary_en: counts_en };
  return { findings, outcome, states, requests };
}
