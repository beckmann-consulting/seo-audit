// Check 1: AI crawlers in robots.txt (RFC 9309). Only documented search bots
// that honour robots.txt count; training bots, user fetchers and
// undocumented tokens are shown only. "No AI bot named" is not a failure:
// the "*" group then applies (RFC 9309).

import { parseRobots, botVerdict } from '../robots';
import { isScoreRelevant } from '../crawlers';
import type { AIBotRow, AICrawlerEntry, AIShadowEntry, RobotsFetch } from '../types';
import type { Module } from '@/types';
import { result, finding, type CheckOutput } from './common';

const OVERVIEWS_DE = 'Google-Extended steuert nur Training und Grounding von Gemini und wirkt nicht auf die Google-Suche; AI Overviews und AI Mode kommen über Googlebot und dessen Snippet-Regeln (nosnippet, max-snippet).';
const OVERVIEWS_EN = 'Google-Extended only controls training and grounding of Gemini and has no effect on Google Search; AI Overviews and AI Mode come through Googlebot and its snippet rules (nosnippet, max-snippet).';

export function botRows(robots: RobotsFetch, crawlers: AICrawlerEntry[]): AIBotRow[] {
  const groups = robots.status === 'ok' ? parseRobots(robots.content ?? '') : [];
  return crawlers.map(c => {
    const v = botVerdict(groups, c.token);
    return {
      token: c.token, vendor: c.vendor, purpose: c.purpose, robotsTxt: c.robotsTxt,
      status: v.status, group: v.group, scoreRelevant: isScoreRelevant(c),
      source: c.source, checked: c.checked, legacy: c.status === 'legacy',
    };
  });
}

export function checkCrawlers(robots: RobotsFetch, crawlers: AICrawlerEntry[], modules: Module[] = []): CheckOutput & { bots: AIBotRow[] } {
  if (robots.status === 'server-error' || robots.status === 'network-error') {
    const why = robots.status === 'server-error' ? `HTTP ${robots.httpStatus}` : 'Netzfehler';
    const whyEn = robots.status === 'server-error' ? `HTTP ${robots.httpStatus}` : 'network error';
    return {
      bots: [],
      findings: [],
      result: result('crawlers', 'not-checkable',
        `robots.txt nicht erreichbar (${why}). Crawler behandeln das nach RFC 9309 wie eine vollständige Sperre; bitte prüfen.`,
        `robots.txt not reachable (${whyEn}). Under RFC 9309 crawlers treat this as a full disallow; please check.`),
    };
  }
  const bots = botRows(robots, crawlers);
  const relevant = bots.filter(b => b.scoreRelevant);
  const blockedAll = relevant.filter(b => b.status === 'blocked');
  // "User-agent: *" with "Disallow: /" is seo's finding (it blocks Googlebot
  // too): bots blocked only through that group are seo's when seo is active,
  // and ai keeps a shadow entry instead of a second finding.
  const groups = robots.status === 'ok' ? parseRobots(robots.content ?? '') : [];
  const wildcardBlocks = groups.some(g => g.agents.includes('*')) && botVerdict(groups.filter(g => g.agents.includes('*')), '*').status === 'blocked';
  const seoOwnsWildcard = wildcardBlocks && modules.includes('seo');
  const viaWildcard = seoOwnsWildcard ? blockedAll.filter(b => b.group === 'wildcard') : [];
  const blocked = blockedAll.filter(b => !viaWildcard.includes(b));
  const shadow: AIShadowEntry[] = viaWildcard.length > 0 ? [{ signal: 'robots-wildcard', owner: 'seo', priority: 'critical' }] : [];
  const details_de: string[] = [OVERVIEWS_DE];
  const details_en: string[] = [OVERVIEWS_EN];
  if (robots.status === 'not-found') {
    details_de.push(`Keine robots.txt (HTTP ${robots.httpStatus}): nach RFC 9309 ist dann alles erlaubt.`);
    details_en.push(`No robots.txt (HTTP ${robots.httpStatus}): under RFC 9309 everything is allowed then.`);
  }
  if (!bots.some(b => b.group === 'own')) {
    details_de.push('Kein KI-Bot ist ausdrücklich genannt; es gilt die Gruppe „*“ (kein Fehler).');
    details_en.push('No AI bot is named explicitly; the "*" group applies (not an error).');
  }
  const userBlocked = bots.filter(b => b.purpose === 'user' && b.status === 'blocked');
  if (userBlocked.length > 0) {
    details_de.push(`Abruf-Bots blockiert: ${userBlocked.map(b => b.token).join(', ')}. Laut Anbietern beachten nicht alle robots.txt sicher; die Sperre wirkt nicht verlässlich.`);
    details_en.push(`User fetchers blocked: ${userBlocked.map(b => b.token).join(', ')}. Per their vendors not all of them reliably honour robots.txt; the block is not dependable.`);
  }
  const trainingBlocked = bots.filter(b => b.purpose === 'training' && b.status === 'blocked');
  if (trainingBlocked.length > 0) {
    details_de.push(`Training-Bots blockiert (legitime Entscheidung, kein Befund): ${trainingBlocked.map(b => b.token).join(', ')}.`);
    details_en.push(`Training bots blocked (a legitimate choice, no finding): ${trainingBlocked.map(b => b.token).join(', ')}.`);
  }
  if (viaWildcard.length > 0) {
    details_de.push('„User-agent: *“ mit „Disallow: /“ sperrt alle Crawler, auch Googlebot: siehe den Befund im Modul SEO.');
    details_en.push('"User-agent: *" with "Disallow: /" blocks every crawler, Googlebot too: see the finding of the SEO module.');
  }
  if (blocked.length === 0 && shadow.length === 0) {
    return { bots, findings: [], result: result('crawlers', 'pass', `Alle ${relevant.length} Such-Bots der KI-Antworten dürfen crawlen.`, `All ${relevant.length} search bots of AI answers may crawl.`, { details_de, details_en }) };
  }
  if (blocked.length === 0) {
    return { bots, findings: [], result: result('crawlers', 'fail', `${blockedAll.length} von ${relevant.length} Such-Bots über „User-agent: *“ blockiert (Befund bei SEO).`, `${blockedAll.length} of ${relevant.length} search bots blocked through "User-agent: *" (finding with SEO).`, { details_de, details_en, shadow }) };
  }
  const all = blockedAll.length === relevant.length;
  const names = blocked.map(b => `${b.token} (${b.vendor})`).join(', ');
  const f = finding(all ? 'critical' : 'important', 'low', 'high', {
    title_de: all ? 'Alle Such-Bots der KI-Antworten in robots.txt blockiert' : `Such-Bots der KI-Antworten in robots.txt blockiert: ${blocked.length} von ${relevant.length}`,
    title_en: all ? 'All AI answer search bots blocked in robots.txt' : `AI answer search bots blocked in robots.txt: ${blocked.length} of ${relevant.length}`,
    description_de: `Diese Bots füllen die Suche der KI-Assistenten; eine Sperre nimmt die Seite aus deren Antworten. Betroffen: ${names}. ${OVERVIEWS_DE}`,
    description_en: `These bots feed the search of AI assistants; blocking them removes the site from their answers. Affected: ${names}. ${OVERVIEWS_EN}`,
    recommendation_de: 'Such-Bots in robots.txt erlauben (z. B. „User-agent: OAI-SearchBot“ mit „Allow: /“). Training-Bots können gesperrt bleiben, das ist eine eigene Entscheidung.',
    recommendation_en: 'Allow the search bots in robots.txt (e.g. "User-agent: OAI-SearchBot" with "Allow: /"). Training bots may stay blocked; that is a separate decision.',
  });
  return {
    bots,
    findings: [f],
    result: result('crawlers', 'fail', `${blockedAll.length} von ${relevant.length} Such-Bots blockiert.`, `${blockedAll.length} of ${relevant.length} search bots blocked.`, { details_de, details_en, shadow }),
  };
}
