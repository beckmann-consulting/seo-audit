import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { CheckLogSection } from './CheckLogSection';
import { CheckLog, outcome } from '@/lib/checks/check-log';
import type { Finding, Module } from '@/types';

const ALL: Module[] = ['seo', 'content', 'legal', 'ux', 'tech', 'performance', 'accessibility', 'ai'];

function fixtureEntries() {
  const log = new CheckLog(ALL);
  const f: Finding = {
    id: 'f1', code: 'tech.soft-404', priority: 'important', module: 'tech', effort: 'low', impact: 'high',
    title_de: 'Soft-404', title_en: 'Soft 404', description_de: '', description_en: '', recommendation_de: '', recommendation_en: '',
  };
  log.record('soft-404', outcome([f], { status: 'pass', summary_de: '', summary_en: '' }, { de: 'Erfundene URL liefert 200.', en: 'Made-up URL answers 200.' }));
  log.record('http-to-https', { status: 'pass', summary_de: 'Einstufige 301 auf HTTPS.', summary_en: 'One-step 301 to HTTPS.' });
  log.record('target-keyword', { status: 'not-configured', summary_de: 'Keine Ziel-Keywords angegeben.', summary_en: 'No target keywords given.' });
  return log.entries();
}

describe('CheckLogSection (ultimate-41)', () => {
  it('renders one row per point with status, summary and finding codes', () => {
    const html = renderToString(createElement(CheckLogSection, { entries: fixtureEntries(), lang: 'en', open: true }));
    expect(html.match(/data-check="/g)).toHaveLength(18);
    expect(html).toContain('data-check="soft-404" data-status="fail"');
    expect(html).toContain('Made-up URL answers 200.');
    expect(html).toContain('tech.soft-404');
    expect(html).toContain('data-check="http-to-https" data-status="pass"');
    expect(html).toContain('One-step 301 to HTTPS.');
    expect(html).toContain('not configured');
    expect(html).toContain('18 check points: 1 passed, 1 with findings, 16 other');
    expect(html).toMatch(/<details[^>]*open/);
  });

  it('German labels, folded by default, nothing for an empty log', () => {
    const html = renderToString(createElement(CheckLogSection, { entries: fixtureEntries(), lang: 'de' }));
    expect(html).toContain('Prüfprotokoll');
    expect(html).toContain('erfüllt');
    expect(html).toContain('nicht eingerichtet');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(renderToString(createElement(CheckLogSection, { entries: [], lang: 'de' }))).toBe('');
  });
});

// Codex, review of 32e99e2094 (finding 4): the table scrolls inside the section on narrow screens
describe('CheckLogSection on narrow screens', () => {
  it('wraps the table in a horizontal scroll container', () => {
    const html = renderToString(createElement(CheckLogSection, { entries: fixtureEntries(), lang: 'en', open: true }));
    expect(html).toMatch(/<div data-scroll="check-log" style="overflow-x:auto;margin-top:8px"><table/);
  });
});
