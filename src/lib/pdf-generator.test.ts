// ultimate-41: the PDF with a fixture result. jsPDF and jspdf-autotable are replaced by stand-ins that write down
// the text and the tables, so the test reads what the PDF would contain.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuditResult, Finding, Module } from '@/types';
import { CheckLog, outcome } from '@/lib/checks/check-log';

interface Table { head?: unknown[][]; body: { content: string }[][]; startY?: number }
const record = vi.hoisted(() => ({ texts: [] as string[], tables: [] as Table[], saved: [] as string[] }));

vi.mock('jspdf', () => {
  class FakeDoc {
    internal = { pages: [null, {}] as unknown[], pageSize: { getWidth: () => 210, getHeight: () => 297, width: 210, height: 297 } };
    lastAutoTable?: { finalY: number };
    constructor() {
      return new Proxy(this, {
        get(target, key) {
          if (key in target) return (target as Record<string | symbol, unknown>)[key];
          return () => undefined;
        },
      });
    }
    text(t: string | string[]) { record.texts.push(...(Array.isArray(t) ? t : [t])); }
    splitTextToSize(t: string) { return [t]; }
    getTextWidth(t: string) { return t.length * 1.5; }
    getStringUnitWidth(t: string) { return t.length * 0.5; }
    getFontSize() { return 10; }
    addPage() { this.internal.pages.push({}); }
    save(name: string) { record.saved.push(name); }
  }
  return { default: FakeDoc, jsPDF: FakeDoc };
});
vi.mock('jspdf-autotable', () => ({
  default: (doc: { lastAutoTable?: { finalY: number } }, opts: Table) => {
    record.tables.push(opts);
    doc.lastAutoTable = { finalY: (opts.startY ?? 0) + 10 };
  },
}));
vi.mock('./pdf-fonts', () => ({ registerInterFont: () => undefined, INTER_FONT_FAMILY: 'Inter' }));

const MODULES: Module[] = ['seo', 'content', 'legal', 'ux', 'tech', 'performance', 'accessibility', 'ai'];

function fixture(): AuditResult {
  const soft404: Finding = {
    id: 'f1', code: 'tech.soft-404', priority: 'important', module: 'tech', effort: 'low', impact: 'high',
    title_de: 'Erfundene URL liefert 200 (Soft-404)', title_en: 'Made-up URL answers 200 (soft 404)',
    description_de: 'd', description_en: 'd', recommendation_de: 'r', recommendation_en: 'r',
  };
  const log = new CheckLog(MODULES);
  log.record('soft-404', outcome([soft404], { status: 'pass', summary_de: '', summary_en: '' }, { de: 'Erfundene URL liefert 200.', en: 'Made-up URL answers 200.' }));
  log.record('http-to-https', { status: 'pass', summary_de: 'Einstufige 301 auf HTTPS.', summary_en: 'One-step 301 to HTTPS.' });
  return {
    config: { url: 'https://example.com/', modules: MODULES, maxPages: 10 },
    auditedAt: '2026-11-14T16:00:00.000Z',
    domain: 'example.com',
    totalScore: 90,
    moduleScores: MODULES.map(m => ({ module: m, score: 90, label_de: m, label_en: m })),
    findings: [soft404],
    strengths_de: ['HTTPS aktiv.'],
    strengths_en: ['HTTPS active.'],
    crawlStats: { totalPages: 1, crawledPages: 1, brokenLinks: [], redirectChains: [], externalLinks: 0, httpErrors: [], unreachable: [], renderFailed: [] },
    pages: [],
    topFindings: [soft404],
    checkLog: log.entries(),
    claudePrompt: '',
    summary_de: '**example.com** erreicht 90.',
    summary_en: '**example.com** reaches 90.',
  };
}

describe('generatePDF with the check log (ultimate-41)', () => {
  beforeEach(() => { record.texts.length = 0; record.tables.length = 0; record.saved.length = 0; });

  it('writes the check log as a table after the findings, one row per point, with codes', async () => {
    const { generatePDF } = await import('./pdf-generator');
    await generatePDF(fixture(), 'en');
    expect(record.saved).toEqual(['example.com-audit-EN-2026-11-14.pdf']);
    expect(record.texts).toContain('Check log');
    expect(record.texts.some(t => t.includes('Made-up URL answers 200 (soft 404)'))).toBe(true);
    const table = record.tables.find(t => JSON.stringify(t.head ?? '').includes('18 check points'));
    expect(table).toBeDefined();
    expect(table!.body).toHaveLength(18);
    const rows = table!.body.map(r => r.map(c => c.content));
    expect(rows).toContainEqual(['2 · soft-404', 'finding: Made-up URL answers 200.', 'tech.soft-404']);
    expect(rows).toContainEqual(['3 · http-to-https', 'passed: One-step 301 to HTTPS.', '']);
    const checkLogTitle = record.texts.indexOf('Check log');
    const finding = record.texts.findIndex(t => t.includes('Made-up URL answers 200 (soft 404)'));
    expect(finding).toBeGreaterThanOrEqual(0);
    expect(checkLogTitle).toBeGreaterThan(finding);
  });

  it('German, and no check log section for an audit saved before ultimate-41', async () => {
    const { generatePDF } = await import('./pdf-generator');
    await generatePDF(fixture(), 'de');
    expect(record.texts).toContain('Prüfprotokoll');
    record.texts.length = 0; record.tables.length = 0;
    const old = fixture();
    delete old.checkLog;
    await generatePDF(old, 'de');
    expect(record.texts).not.toContain('Prüfprotokoll');
  });
});

describe('generatePDF with the local Lighthouse table (ultimate-41, point 4)', () => {
  beforeEach(() => { record.texts.length = 0; record.tables.length = 0; record.saved.length = 0; });

  it('a table with one row per page and strategy, the runs as note, and the versions', async () => {
    const { generatePDF } = await import('./pdf-generator');
    const { LIGHTHOUSE_FIXTURE } = await import('@/lib/lighthouse/__fixtures__/info');
    await generatePDF({ ...fixture(), lighthouseLocal: LIGHTHOUSE_FIXTURE }, 'en');
    const table = record.tables.find(t => JSON.stringify(t.head ?? '').includes('Local Lighthouse, lab measurement'));
    expect(table).toBeDefined();
    const rows = table!.body.map(r => r.map(c => c.content));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual(['mobile: https://example.com/', 'Score 75 · LCP 2.5 s · CLS 0.012 · TBT 140 ms', 'Runs: 60, 90, 75']);
    expect(rows[3]).toEqual(['Desktop: https://example.com/b', 'Score n/a · LCP n/a · CLS n/a · TBT n/a', 'Runs: not measured']);
    expect(rows[4][1]).toMatch(/^Lighthouse 13\.6\.0 · Chromium 142\.0\.7444\.59 · 183 s · incomplete/);
  });
});
