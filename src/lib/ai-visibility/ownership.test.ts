// Every signal has one owner (plan, table 3a): with all modules active, a
// fixture that breaks each shared signal once gets exactly one finding per
// signal, never one from seo, content, legal or tech AND one from ai.

import { describe, it, expect } from 'vitest';
import { evaluateAIVisibility } from './index';
import { generateRobotsWildcardFindings, generateStructuredDataFindings, generateContentFindings, generateLegalFindings, generateJsRenderingFindings } from '@/lib/findings-engine';
import { detectLegalPages } from '@/lib/util/legal-page-detection';
import { seoPage, schema, words, html } from './__fixtures__/pages';
import type { Finding, Module, PageData } from '@/types';

const MODULES: Module[] = ['seo', 'content', 'legal', 'ux', 'tech', 'performance', 'ai'];
const robots = 'User-agent: *\nDisallow: /\n';

const homeHtml = html(`<main><h1>Start</h1><p>${words(80)}</p></main><footer><a href="/kontakt">Kontakt</a></footer>`);
const blogA = html(`<main><h1>Artikel A</h1><p>${words(600)}</p></main>`);
const blogB = html(`<main><h1>Artikel B</h1><p>${words(400)}</p></main>`);
const jsStatic = html('<main><h1>App</h1><h2>Teil</h2><p>kurz</p></main>');
const jsRendered = html(`<main><h1>App</h1><h2>Teil</h2><p>${words(300)}</p></main>`);

const pages = [
  seoPage({ url: 'https://example.com/', wordCount: 80, schemaParseErrors: 1, schemas: [schema('Organization', { name: 'B' }), schema('FAQPage', { mainEntity: [{ '@type': 'Question' }] })] }),
  seoPage({ url: 'https://example.com/blog/a', wordCount: 600, hasAuthorSignal: false, hasDateSignal: false }),
  seoPage({ url: 'https://example.com/blog/b', wordCount: 400, hasAuthorSignal: true, hasDateSignal: true, schemas: [schema('Article', { headline: 'B', image: 'i', datePublished: '2026-11-06', author: { '@type': 'Person', name: 'T' } })] }),
  seoPage({ url: 'https://example.com/app', wordCount: 300, renderMode: 'js', staticWordCount: 5 }),
];
const raw = (url: string, h: string, extra: Partial<PageData> = {}): PageData => ({
  url, html: h, statusCode: 200, depth: 0, redirectChain: [], finalUrl: url, httpStatus: 200, protocol: null, ...extra,
});
const rawPages: PageData[] = [
  raw('https://example.com/', homeHtml),
  raw('https://example.com/blog/a', blogA),
  raw('https://example.com/blog/b', blogB),
  raw('https://example.com/app', jsRendered, { staticHtml: jsStatic, renderMode: 'js' }),
];
const allHtml = rawPages.map(p => p.html).join('\n');

function run() {
  const owners = [
    ...generateRobotsWildcardFindings(robots),
    ...generateStructuredDataFindings(pages),
    ...generateContentFindings(pages),
    ...generateLegalFindings(pages, allHtml),
    ...generateJsRenderingFindings(pages),
  ];
  const ai = evaluateAIVisibility({
    pages, rawPages, robots: { status: 'ok', httpStatus: 200, content: robots },
    llms: { status: 'absent', url: 'https://example.com/llms.txt' }, modules: MODULES,
    imprintFound: detectLegalPages(pages, allHtml.toLowerCase()).imprint.found,
  });
  return { owners, ai };
}
function all(): Finding[] {
  const { owners, ai } = run();
  return [...owners, ...ai.findings];
}

// the owner's finding behind each shadow signal
const OWNER_FINDING: Record<string, RegExp> = {
  'robots-wildcard': /robots\.txt blocks all bots/,
  'schema-parse': /^JSON-LD parse errors/,
  'schema-required': /required fields missing/,
  'schema-recommended': /^Schema recommendations/,
  'schema-substructure': /^Schema substructure broken/,
  'author-any': /No author signal/,
  'date-any': /No date signal/,
  'imprint-missing': /No legal notice/,
  'js-required': /JavaScript rendering required/,
  'csr-shell': /Site appears client-side rendered/,
};

const count = (fs: Finding[], re: RegExp) => fs.filter(f => re.test(f.title_en)).length;

describe('one finding per signal with all modules active (ownership table 3a)', () => {
  const fs = all();
  it('robots.txt "User-agent: *" with "Disallow: /": only seo', () => {
    expect(count(fs, /robots\.txt blocks all bots|search bots blocked/i)).toBe(1);
    expect(fs.find(f => /robots\.txt blocks all bots/.test(f.title_en))?.module).toBe('seo');
  });
  it('a required field of Organization: only seo', () => {
    expect(count(fs, /Schema\.org Organization: required fields missing|Required fields missing in/)).toBe(1);
    expect(count(fs, /Required fields missing in/)).toBe(0);
  });
  it('no author or date signal at all: only content; a schema-only author or date: only ai, for that page', () => {
    expect(count(fs, /No author signal/)).toBe(1);
    expect(count(fs, /No date signal/)).toBe(1);
    const visible = fs.filter(f => /No visible (author|date)/.test(f.title_en));
    for (const f of visible) {
      expect(f.description_en).toContain('https://example.com/blog/b');
      expect(f.description_en).not.toContain('https://example.com/blog/a');
    }
  });
  it('no Impressum at all: only legal', () => {
    expect(count(fs, /legal notice|Impressum/i)).toBe(1);
    expect(fs.find(f => /legal notice|Impressum/i.test(f.title_en))?.module).toBe('legal');
  });
  it('main text only after JavaScript by word count: only tech', () => {
    expect(count(fs, /JavaScript rendering required|Main text or headings only present after JavaScript/)).toBe(1);
    expect(fs.find(f => /JavaScript rendering required/.test(f.title_en))?.module).toBe('tech');
  });
  it('JSON-LD parse errors and a FAQPage without question and answer: only seo (Prüfer-209, Prüfer-211)', () => {
    expect(count(fs, /JSON-LD parse errors|JSON-LD with parse errors/)).toBe(1);
    expect(count(fs, /Schema substructure broken|Inner structure broken/)).toBe(1);
    expect(fs.find(f => /Schema substructure broken/.test(f.title_en))?.module).toBe('seo');
  });
  it('every shadow entry carries the priority of its owner\'s finding (plan 3b)', () => {
    const { owners, ai } = run();
    const shadows = ai.info.checks.flatMap(c => c.shadow);
    expect(shadows.map(s => s.signal).sort()).toEqual(['author-any', 'date-any', 'imprint-missing', 'js-required', 'robots-wildcard',
      'schema-parse', 'schema-recommended', 'schema-required', 'schema-substructure']);
    for (const s of shadows) {
      const owner = owners.filter(f => f.module === s.owner && OWNER_FINDING[s.signal].test(f.title_en));
      expect(owner.length, s.signal).toBeGreaterThan(0);
      expect(owner.map(f => f.priority), s.signal).toContain(s.priority);
    }
  });
  it('the ai module score still counts the shadowed failures', () => {
    const ai = evaluateAIVisibility({
      pages, rawPages, robots: { status: 'ok', httpStatus: 200, content: robots },
      llms: { status: 'absent', url: 'https://example.com/llms.txt' }, modules: MODULES, imprintFound: false,
    });
    expect(ai.info.score).toBeLessThan(100);
    expect(ai.info.checks.find(c => c.id === 'crawlers')?.shadow[0]?.owner).toBe('seo');
  });
});
