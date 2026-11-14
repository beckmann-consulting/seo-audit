// ultimate-41, point 2: a made-up URL must answer 404 (or 410), with a page of the site's own.
// Journal ultimate-41-plan.md section 3, B2. One probe at the root, one more under the first path segment of the
// start URL (SPA fallbacks often sit on the language path, e.g. /de/...). Only the first answer counts.
import { randomBytes } from 'node:crypto';
import { parse } from 'node-html-parser';
import type { Finding } from '@/types';
import { id } from '@/lib/findings/utils';
import type { CheckOutcome } from './check-log';
import { probeChain, type ProbeOptions, type ProbeResult } from './probe';

export interface Soft404Probe {
  url: string;
  result: ProbeResult;
}

export interface Soft404Input extends Omit<ProbeOptions, 'follow' | 'maxHops'> {
  startUrl: string; // the start page as crawled (final URL)
  token?: string; // tests: a fixed random part
}

export function probeUrls(startUrl: string, token: string): string[] {
  const u = new URL(startUrl);
  const name = `seo-audit-404-check-${token}`;
  const urls = [`${u.origin}/${name}`];
  const first = u.pathname.split('/').filter(Boolean)[0];
  if (first && !first.includes('.')) urls.push(`${u.origin}/${first}/${name}`);
  return urls;
}

/** A 404 page of the site's own: HTML with a title, at least 20 words and a link to the site. */
export function isOwn404Page(body: Buffer, contentType: string | undefined, pageUrl: string): boolean {
  if (!/html/i.test(contentType ?? '')) return false;
  const root = parse(body.toString('utf8'));
  const title = root.querySelector('title')?.text.trim() ?? '';
  root.querySelectorAll('script, style, noscript').forEach(n => n.remove());
  const words = (root.querySelector('body')?.text ?? root.text).split(/\s+/).filter(w => /\p{L}/u.test(w)).length;
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const linksHome = root.querySelectorAll('a[href]').some(a => {
    const href = a.getAttribute('href') ?? '';
    try {
      const target = new URL(href, pageUrl);
      return /^https?:$/.test(target.protocol) && target.hostname.replace(/^www\./, '') === host;
    } catch { return false; }
  });
  return title.length > 0 && words >= 20 && linksHome;
}

const list = (urls: string[]) => urls.slice(0, 5).join(', ');

function make(code: string, priority: Finding['priority'], urls: string[], t: { title_de: string; title_en: string; description_de: string; description_en: string; recommendation_de: string; recommendation_en: string }): Finding {
  return { id: id(), code, priority, module: 'tech', effort: 'low', impact: priority === 'important' ? 'high' : 'medium', affectedUrl: urls[0], ...t };
}

export async function checkSoft404(i: Soft404Input): Promise<{ findings: Finding[]; outcome: CheckOutcome; probes: Soft404Probe[] }> {
  const token = i.token ?? randomBytes(4).toString('hex');
  const probes: Soft404Probe[] = [];
  for (const url of probeUrls(i.startUrl, token)) {
    probes.push({ url, result: await probeChain(url, { ...i, follow: 'none', maxHops: 1 }) });
  }
  const ok200: string[] = [];
  const redirected: string[] = [];
  const server: string[] = [];
  const other: string[] = [];
  const notOwn: string[] = [];
  const unanswered: string[] = [];
  for (const p of probes) {
    const first = p.result.steps[0];
    const final = p.result.final;
    if (!first || !final) { unanswered.push(`${p.url} (${p.result.reason ?? p.result.stopped ?? 'no answer'})`); continue; }
    if (first.status === 404 || first.status === 410) {
      if (!isOwn404Page(final.body, final.headers['content-type'], p.url)) notOwn.push(p.url);
    } else if (first.status >= 200 && first.status < 300) ok200.push(p.url);
    else if (first.status >= 300 && first.status < 400) redirected.push(`${p.url} → ${first.location ?? '?'} (${first.status})`);
    else if (first.status >= 500) server.push(`${p.url} (${first.status})`);
    else other.push(`${p.url} (${first.status})`);
  }

  const findings: Finding[] = [];
  if (ok200.length > 0) findings.push(make('tech.soft-404', 'important', ok200, {
    title_de: 'Erfundene URL liefert 200 (Soft-404)',
    title_en: 'Made-up URL answers 200 (soft 404)',
    description_de: `Eine URL, die es nicht gibt, antwortet mit Status 200 statt 404: ${list(ok200)}. Suchmaschinen sehen darin eine Soft-404 und verschwenden Crawl-Budget; falsche Links fallen niemandem auf.`,
    description_en: `A URL that does not exist answers with status 200 instead of 404: ${list(ok200)}. Search engines treat this as a soft 404 and waste crawl budget; broken links go unnoticed.`,
    recommendation_de: 'Unbekannte Pfade mit Status 404 beantworten (bei Single-Page-Apps im Server oder Hosting-Fallback, nicht nur im Client).',
    recommendation_en: 'Answer unknown paths with status 404 (for single-page apps in the server or hosting fallback, not only in the client).',
  }));
  if (redirected.length > 0) findings.push(make('tech.soft-404-redirect', 'recommended', redirected, {
    title_de: 'Erfundene URL wird weitergeleitet statt 404',
    title_en: 'Made-up URL is redirected instead of 404',
    description_de: `Unbekannte URLs leiten weiter: ${list(redirected)}. Google wertet Weiterleitungen nicht vorhandener Seiten, etwa auf die Startseite, als Soft-404.`,
    description_en: `Unknown URLs redirect: ${list(redirected)}. Google treats redirects of pages that do not exist, e.g. to the start page, as soft 404s.`,
    recommendation_de: 'Unbekannte Pfade direkt mit 404 beantworten; Weiterleitungen nur für verschobene Inhalte.',
    recommendation_en: 'Answer unknown paths with 404 directly; redirect only content that moved.',
  }));
  if (server.length > 0) findings.push(make('tech.404-probe-server-error', 'recommended', server, {
    title_de: 'Erfundene URL führt zu einem Serverfehler',
    title_en: 'Made-up URL causes a server error',
    description_de: `Statt 404 antwortet der Server mit einem Fehler: ${list(server)}.`,
    description_en: `Instead of 404 the server answers with an error: ${list(server)}.`,
    recommendation_de: 'Unbekannte Pfade im Server oder in der Anwendung abfangen und mit 404 beantworten.',
    recommendation_en: 'Catch unknown paths in the server or the application and answer them with 404.',
  }));
  if (other.length > 0) findings.push(make('tech.404-probe-status', 'optional', other, {
    title_de: 'Erfundene URL antwortet nicht mit 404',
    title_en: 'Made-up URL does not answer 404',
    description_de: `Unbekannte URLs antworten mit einem anderen Status als 404 oder 410: ${list(other)}.`,
    description_en: `Unknown URLs answer with a status other than 404 or 410: ${list(other)}.`,
    recommendation_de: 'Für nicht vorhandene Seiten 404 (oder 410 für dauerhaft entfernte) senden.',
    recommendation_en: 'Send 404 for pages that do not exist (or 410 for permanently removed ones).',
  }));
  if (notOwn.length > 0) findings.push(make('tech.no-custom-404', 'optional', notOwn, {
    title_de: 'Keine eigene 404-Seite',
    title_en: 'No custom 404 page',
    description_de: `Die 404-Antwort hat keinen Title, kaum Text oder keinen Link zurück auf die Website: ${list(notOwn)}. Besucher landen auf einer Sackgasse.`,
    description_en: `The 404 answer has no title, hardly any text or no link back to the site: ${list(notOwn)}. Visitors hit a dead end.`,
    recommendation_de: 'Eine eigene 404-Seite mit Navigation, Suche oder Links zu den wichtigsten Seiten anlegen (Status 404 beibehalten).',
    recommendation_en: 'Add a custom 404 page with navigation, search or links to the main pages (keep status 404).',
  }));

  const answered = probes.length - unanswered.length;
  let outcome: CheckOutcome;
  if (findings.length > 0) {
    outcome = { status: 'fail', findings, summary_de: `${findings.length} Befund(e) bei ${probes.length} erfundenen URL(s).`, summary_en: `${findings.length} finding(s) for ${probes.length} made-up URL(s).` };
  } else if (unanswered.length > 0) {
    outcome = { status: 'not-checkable', summary_de: `${answered} von ${probes.length} erfundenen URLs beantwortet; nicht prüfbar: ${list(unanswered)}.`, summary_en: `${answered} of ${probes.length} made-up URLs answered; not checkable: ${list(unanswered)}.` };
  } else {
    outcome = { status: 'pass', summary_de: `${probes.length} erfundene URL(s) antworten mit 404 und einer eigenen 404-Seite.`, summary_en: `${probes.length} made-up URL(s) answer 404 with a custom 404 page.` };
  }
  return { findings, outcome, probes };
}
