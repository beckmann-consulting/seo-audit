// ultimate-41, point 14: inbound anchor texts per target page (generic, off topic, uniform), and the caps.
import { describe, it, expect } from 'vitest';
import { generateInboundAnchorFindings, buildAnchorGraph, normaliseAnchor } from './inbound-anchors';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';
import type { PageSEOData } from '@/types';

const B = 'https://example.com';
const shell = (nav: string, body: string) => `<html><body><nav>${nav}</nav><main>${body}</main><footer><a href="/impressum">Impressum</a></footer></body></html>`;

function run(pages: PageSEOData[], raw: { url: string; html: string }[], caps?: { pairs: number; links: number }) {
  const log = new CheckLog(['seo']);
  const f = generateInboundAnchorFindings(pages, raw, log, caps);
  return { codes: f.map(x => x.code), findings: f, entry: log.entries().find(e => e.check === 'inbound-anchors')! };
}

const target = seoPage({ url: `${B}/webdesign`, depth: 1, title: 'Webdesign für KMU', h1s: ['Webdesign'] });
const start = seoPage({ url: `${B}/`, depth: 0 });

describe('inbound anchors (ultimate-41, point 14)', () => {
  it('descriptive and varied anchors: passed', () => {
    const raw = [
      { url: `${B}/`, html: shell('<a href="/webdesign">Webdesign</a>', '<a href="/webdesign">unser Webdesign für kleine Firmen</a>') },
      { url: `${B}/blog`, html: shell('<a href="/webdesign">Webdesign</a>', '<a href="/webdesign">Webdesign-Pakete</a>') },
    ];
    const r = run([start, target, seoPage({ url: `${B}/blog`, depth: 1 })], raw);
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
  });

  it('only generic or empty anchors: generic', () => {
    const raw = [
      { url: `${B}/`, html: shell('', '<a href="/webdesign">mehr</a>') },
      { url: `${B}/blog`, html: shell('', '<a href="/webdesign">hier</a><a href="/webdesign"><img src="/x.png" alt=""></a>') },
    ];
    expect(run([start, target, seoPage({ url: `${B}/blog`, depth: 1 })], raw).codes).toEqual(['seo.inbound-anchors-generic']);
  });

  it('no anchor names the topic: off topic', () => {
    const raw = [
      { url: `${B}/`, html: shell('', '<a href="/webdesign">Unsere Arbeit</a>') },
      { url: `${B}/blog`, html: shell('', '<a href="/webdesign">Projekte ansehen</a>') },
    ];
    expect(run([start, target, seoPage({ url: `${B}/blog`, depth: 1 })], raw).codes).toEqual(['seo.inbound-anchors-off-topic']);
  });

  // 20 pages; content links from 6 of them (30 %, below the template share of 40 %)
  const others = Array.from({ length: 14 }, (_, i) => ({ url: `${B}/o${i}`, html: shell('', '<p>Text</p>') }));

  it('uniform: 6 source pages with the same anchor in the content; varied anchors or the navigation alone are not', () => {
    const sources = Array.from({ length: 6 }, (_, i) => `${B}/p${i}`);
    const same = [...sources.map(u => ({ url: u, html: shell('', '<a href="/webdesign">Webdesign</a>') })), ...others];
    const pages = [start, target, ...sources.map(u => seoPage({ url: u, depth: 1 }))];
    const r = run(pages, same);
    expect(r.codes).toEqual(['seo.inbound-anchors-uniform']);
    expect(r.findings[0].description_en).toMatch(/"webdesign" from 6 of 6 pages/);
    const varied = [...sources.map((u, i) => ({ url: u, html: shell('', `<a href="/webdesign">${['Webdesign', 'Webdesign für KMU', 'Webdesign-Pakete'][i % 3]}</a>`) })), ...others];
    expect(run(pages, varied).codes).toEqual([]);
    const navOnly = Array.from({ length: 30 }, (_, i) => ({ url: `${B}/n${i}`, html: shell('<a href="/webdesign">Webdesign</a>', '') }));
    expect(run([start, target, ...navOnly.map(n => seoPage({ url: n.url, depth: 1 }))], navOnly).codes).toEqual([]);
    const four = [...sources.slice(0, 4).map(u => ({ url: u, html: shell('', '<a href="/webdesign">Webdesign</a>') })), ...others];
    expect(run(pages, four).codes).toEqual([]);
  });

  it('a template link in the content on 40 % or more of the pages counts like navigation (no uniform finding)', () => {
    const all = Array.from({ length: 10 }, (_, i) => ({ url: `${B}/t${i}`, html: shell('', '<a href="/webdesign">Webdesign ansehen</a>') }));
    const pages = [start, target, ...all.map(a => seoPage({ url: a.url, depth: 1 }))];
    expect(run(pages, all).codes).toEqual([]);
  });

  it('a card link with blocks: their texts do not run together', () => {
    const card = '<a href="/webdesign"><h3>Webdesign</h3><p>Ihre Idee wird klickbar</p></a>';
    const g = buildAnchorGraph([{ url: `${B}/`, html: shell('', card) }]);
    expect([...g.targets.get(`${B}/webdesign`)!.anchors.keys()]).toEqual(['webdesign ihre idee wird klickbar']);
  });

  it('a navigation link repeated on 30 pages counts once', () => {
    const navOnly = Array.from({ length: 30 }, (_, i) => ({ url: `${B}/n${i}`, html: shell('<a href="/webdesign">Webdesign</a>', '') }));
    const g = buildAnchorGraph(navOnly);
    const t = g.targets.get(`${B}/webdesign`)!;
    expect(t.anchors.get('webdesign')?.count).toBe(1);
    expect(t.sources.size).toBe(30);
  });

  it('caps: a fitting anchor behind the cap gives no off-topic finding and no pass', () => {
    const raw = [
      { url: `${B}/`, html: shell('', '<a href="/webdesign">Unsere Arbeit</a>') },
      { url: `${B}/blog`, html: shell('', '<a href="/webdesign">Projekte</a>') },
      { url: `${B}/news`, html: shell('', '<a href="/webdesign">Webdesign für KMU</a>') },
    ];
    const pages = [start, target, seoPage({ url: `${B}/blog`, depth: 1 }), seoPage({ url: `${B}/news`, depth: 1 })];
    const cut = run(pages, raw, { pairs: 50_000, links: 4 });
    expect(cut.codes).toEqual([]);
    expect(cut.entry.status).toBe('not-checkable');
    expect(cut.entry.summary_en).toMatch(/a cap was reached \(50000 pairs or 4 links\)/);
    const pairCut = run(pages, raw, { pairs: 2, links: 200_000 });
    expect(pairCut.entry.status).toBe('not-checkable');
    expect(run(pages, raw).codes).toEqual([]); // complete: the third anchor names the topic
  });

  it('normaliseAnchor', () => {
    expect(normaliseAnchor('  Mehr   erfahren!  ')).toBe('mehr erfahren');
    expect(normaliseAnchor('„Webdesign“')).toBe('webdesign');
  });
});
