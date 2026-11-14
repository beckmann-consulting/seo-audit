// ultimate-41, point 14 (journal ultimate-41-plan.md 1.5 and section 5): the anchor texts that link to each page.
//
// The link graph lives during the analysis only. It is condensed while it is read: per target page one table of
// normalised anchors with their count, context and at most 3 source pages. Caps per audit, also with maxPages 0:
// 50 000 different pairs of target and anchor, 200 000 links read. Past a cap every target may miss anchors from
// pages not read, so none of the findings that speak about all inbound anchors is given, and the point is not
// checkable.
//
// Links in navigation and footer repeat on every page; one pair of anchor and context counts once per target there,
// so they do not drown the links in the content.
import { parse, type HTMLElement } from 'node-html-parser';
import type { Finding, PageSEOData } from '@/types';
import { id } from './utils';
import { normaliseUrl } from '@/lib/util/url-normalize';
import { GENERIC_ANCHOR_TEXTS } from '@/lib/extractor';
import { EXCLUSIVE } from '@/lib/util/lang-detect';
import type { CheckLog } from '@/lib/checks/check-log';

export const PAIR_CAP = 50_000;
export const LINK_CAP = 200_000;
export const MIN_INLINKS = 2;
export const UNIFORM_MIN_SOURCES = 5;
export const UNIFORM_SHARE = 0.8;
// a content link with the same anchor to the same page on at least this share of the crawled pages is a template link
// (a teaser, "back to the homepage", a privacy hint) and counts like navigation, not for the variety of anchors
export const TEMPLATE_SHARE = 0.4;

export type LinkContext = 'nav' | 'footer' | 'body';

interface AnchorStat { display: string; count: number; contexts: Set<LinkContext>; sources: string[] }

export interface TargetAnchors {
  anchors: Map<string, AnchorStat>; // normalised anchor → stat
  sources: Set<string>; // every page linking here
  bodyAnchorOf: Map<string, string>; // body source page → its (first) normalised anchor
  seenNavFooter: Set<string>; // "context|anchor" counted once
}

export interface AnchorGraph { targets: Map<string, TargetAnchors>; complete: boolean; linksRead: number; pairs: number }

export function normaliseAnchor(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').trim();
}

function contextOf(a: HTMLElement): LinkContext {
  for (let n: HTMLElement | null = a.parentNode as HTMLElement | null; n && n.tagName; n = n.parentNode as HTMLElement | null) {
    const tag = n.tagName.toLowerCase();
    const role = (n.getAttribute?.('role') || '').toLowerCase();
    if (tag === 'footer' || role === 'contentinfo') return 'footer';
    if (tag === 'nav' || tag === 'header' || role === 'navigation' || role === 'banner') return 'nav';
  }
  return 'body';
}

const site = (host: string) => host.toLowerCase().replace(/^www\./, '');

/** The text of a link with a space between its text nodes: blocks inside a card link must not run together. */
function textOf(a: HTMLElement): string {
  const parts: string[] = [];
  const walk = (n: { nodeType: number; rawText?: string; text?: string; childNodes?: unknown[]; tagName?: string }) => {
    if (n.nodeType === 3) { parts.push(n.text ?? n.rawText ?? ''); return; }
    if (n.nodeType !== 1 || /^(script|style|noscript)$/i.test(n.tagName ?? '')) return;
    for (const c of n.childNodes ?? []) walk(c as Parameters<typeof walk>[0]);
  };
  walk(a as unknown as Parameters<typeof walk>[0]);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function buildAnchorGraph(rawPages: { url: string; html: string }[], caps: { pairs: number; links: number } = { pairs: PAIR_CAP, links: LINK_CAP }): AnchorGraph {
  const targets = new Map<string, TargetAnchors>();
  let linksRead = 0;
  let pairs = 0;
  for (const page of rawPages) {
    let base: URL;
    try { base = new URL(page.url); } catch { continue; }
    const source = normaliseUrl(page.url);
    for (const a of parse(page.html).querySelectorAll('a[href]')) {
      let to: URL;
      try { to = new URL(a.getAttribute('href') || '', base); } catch { continue; }
      if (!/^https?:$/.test(to.protocol) || site(to.hostname) !== site(base.hostname)) continue;
      to.hash = '';
      const target = normaliseUrl(to.href);
      if (target === source) continue;
      if (++linksRead > caps.links) return { targets, complete: false, linksRead: linksRead - 1, pairs };
      const imgAlt = a.querySelector('img[alt]')?.getAttribute('alt') ?? '';
      const display = (textOf(a) || imgAlt.trim() || (a.getAttribute('aria-label') || '').trim()).slice(0, 100);
      const key = normaliseAnchor(display);
      const ctx = contextOf(a);
      let t = targets.get(target);
      if (!t) { t = { anchors: new Map(), sources: new Set(), bodyAnchorOf: new Map(), seenNavFooter: new Set() }; targets.set(target, t); }
      t.sources.add(source);
      if (ctx !== 'body') {
        const once = `${ctx}|${key}`;
        if (t.seenNavFooter.has(once)) continue;
        t.seenNavFooter.add(once);
      } else if (!t.bodyAnchorOf.has(source)) {
        t.bodyAnchorOf.set(source, key);
      }
      let st = t.anchors.get(key);
      if (!st) {
        if (++pairs > caps.pairs) return { targets, complete: false, linksRead, pairs: pairs - 1 };
        st = { display, count: 0, contexts: new Set(), sources: [] };
        t.anchors.set(key, st);
      }
      st.count++;
      st.contexts.add(ctx);
      if (st.sources.length < 3 && !st.sources.includes(page.url)) st.sources.push(page.url);
    }
  }
  return { targets, complete: true, linksRead, pairs };
}

const STOP = new Set([...EXCLUSIVE.keys(), 'in', 'an', 'am', 'die', 'so', 'de', 'la', 'en', 'es', 'un', 'is']);
const meaningful = (s: string) => normaliseAnchor(s).split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4 && !STOP.has(w));

export function generateInboundAnchorFindings(pages: PageSEOData[], rawPages: { url: string; html: string }[], log?: CheckLog, caps?: { pairs: number; links: number }): Finding[] {
  const used = caps ?? { pairs: PAIR_CAP, links: LINK_CAP };
  const graph = buildAnchorGraph(rawPages, used);
  const counts_de = `${graph.linksRead} interne Links, ${graph.pairs} Paare aus Zielseite und Anker.`;
  const counts_en = `${graph.linksRead} internal links, ${graph.pairs} pairs of target and anchor.`;
  if (!graph.complete) {
    log?.record('inbound-anchors', {
      status: 'not-checkable',
      summary_de: `Linkgraph unvollständig: Grenze erreicht (${used.pairs} Paare oder ${used.links} Links); ${counts_de}`,
      summary_en: `Link graph incomplete: a cap was reached (${used.pairs} pairs or ${used.links} links); ${counts_en}`,
    });
    return [];
  }
  const start = pages.find(p => p.depth === 0) ?? pages[0];
  const generic: string[] = [];
  const offTopic: string[] = [];
  const uniform: string[] = [];
  let judged = 0;
  for (const p of pages) {
    if (p === start) continue;
    const t = graph.targets.get(normaliseUrl(p.url));
    if (!t || t.sources.size < MIN_INLINKS) continue;
    judged++;
    const keys = [...t.anchors.keys()];
    if (keys.every(k => !k || GENERIC_ANCHOR_TEXTS.has(k))) generic.push(`${p.url} (${keys.map(k => `"${k}"`).join(', ') || 'leer/empty'})`);
    else {
      const topic = new Set([...meaningful(p.title ?? ''), ...(p.h1s ?? []).flatMap(h => meaningful(h))]);
      const anchorWords = new Set(keys.flatMap(k => meaningful(k)));
      if (topic.size > 0 && ![...anchorWords].some(w => topic.has(w))) offTopic.push(`${p.url} (${[...t.anchors.values()].slice(0, 3).map(a => `"${a.display}"`).join(', ')})`);
    }
    const all = [...t.bodyAnchorOf.values()];
    const uses = new Map<string, number>();
    for (const k of all) uses.set(k, (uses.get(k) ?? 0) + 1);
    const templateMin = Math.max(UNIFORM_MIN_SOURCES, Math.ceil(TEMPLATE_SHARE * rawPages.length));
    const body = all.filter(k => (uses.get(k) ?? 0) < templateMin);
    if (body.length >= UNIFORM_MIN_SOURCES) {
      const tally = new Map<string, number>();
      for (const k of body) tally.set(k, (tally.get(k) ?? 0) + 1);
      const [top, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (n / body.length >= UNIFORM_SHARE) uniform.push(`${p.url} ("${top}" from ${n} of ${body.length} pages)`);
    }
  }
  const sample = (xs: string[]) => xs.slice(0, 5).join('; ') + (xs.length > 5 ? ` (+${xs.length - 5})` : '');
  const findings: Finding[] = [];
  const make = (code: string, xs: string[], title_de: string, title_en: string, d_de: string, d_en: string, r_de: string, r_en: string) => findings.push({
    id: id(), code, priority: 'optional', module: 'seo', effort: 'low', impact: 'low', affectedUrl: xs[0].split(' ')[0],
    title_de, title_en, description_de: `${d_de} ${sample(xs)}.`, description_en: `${d_en} ${sample(xs)}.`, recommendation_de: r_de, recommendation_en: r_en,
  });
  if (generic.length) make('seo.inbound-anchors-generic', generic, `${generic.length} Seite(n) nur mit generischen eingehenden Ankern`, `${generic.length} page(s) with generic inbound anchors only`,
    'Alle internen Links auf diese Seiten tragen Texte wie „mehr“ oder „hier“ oder keinen Text:', 'Every internal link to these pages says "more", "here" or nothing:',
    'Mindestens einen Link mit beschreibendem Text zum Thema der Seite setzen.', 'Give at least one link a descriptive text on the page topic.');
  if (offTopic.length) make('seo.inbound-anchors-off-topic', offTopic, `${offTopic.length} Seite(n): kein eingehender Anker nennt das Thema`, `${offTopic.length} page(s): no inbound anchor names the topic`,
    'Kein Ankertext teilt ein bedeutungstragendes Wort mit Title oder H1 der Zielseite:', 'No anchor text shares a meaningful word with the target page title or H1:',
    'Ankertexte verwenden, die das Thema der Zielseite nennen.', 'Use anchor texts that name the topic of the target page.');
  if (uniform.length) make('seo.inbound-anchors-uniform', uniform, `${uniform.length} Seite(n) mit einförmigen eingehenden Ankern`, `${uniform.length} page(s) with uniform inbound anchors`,
    'Links aus dem Inhalt vieler Seiten tragen fast alle denselben Text:', 'Links from the content of many pages nearly all carry the same text:',
    'Ankertexte im Fließtext variieren und auf den jeweiligen Zusammenhang abstimmen.', 'Vary anchor texts in running text and fit them to their context.');
  log?.record('inbound-anchors', findings.length > 0
    ? { status: 'fail', findings, summary_de: `${judged} Zielseiten mit mindestens ${MIN_INLINKS} eingehenden Links bewertet; ${counts_de}`, summary_en: `${judged} target pages with at least ${MIN_INLINKS} inbound links judged; ${counts_en}` }
    : judged === 0
      ? { status: 'not-applicable', summary_de: `Keine Unterseite mit mindestens ${MIN_INLINKS} eingehenden Links; ${counts_de}`, summary_en: `No subpage with at least ${MIN_INLINKS} inbound links; ${counts_en}` }
      : { status: 'pass', summary_de: `${judged} Zielseiten: beschreibende, passende und abwechslungsreiche Anker; ${counts_de}`, summary_en: `${judged} target pages: descriptive, fitting and varied anchors; ${counts_en}` });
  return findings;
}
