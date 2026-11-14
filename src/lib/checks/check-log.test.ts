import { describe, it, expect } from 'vitest';
import type { Finding, Module } from '@/types';
import { CheckLog, CHECK_POINTS, outcome } from './check-log';

const ALL: Module[] = ['seo', 'content', 'legal', 'ux', 'tech', 'performance', 'accessibility', 'ai'];

function finding(code: string | undefined, module: Module = 'tech'): Finding {
  return {
    id: 'f1', priority: 'recommended', module, effort: 'low', impact: 'low', title_de: 't', title_en: 't',
    description_de: '', description_en: '', recommendation_de: '', recommendation_en: '', ...(code ? { code } : {}),
  };
}

describe('check log (ultimate-41, plan 1.2)', () => {
  it('always 18 entries, one per point of the order, in a fixed order', () => {
    const entries = new CheckLog(ALL).entries();
    expect(entries).toHaveLength(18);
    expect(entries.map(e => e.point)).toEqual(['1', '16', '17', '2', '3', '4', '5', '6', '7', '19', '10', '11', '13', '14', '18', '20', 'E1', 'E2']);
    expect(new Set(entries.map(e => e.check)).size).toBe(18);
    expect(CHECK_POINTS).toHaveLength(18);
  });

  it('a check of a module not chosen is not-selected; a chosen one never recorded is not-checkable', () => {
    const log = new CheckLog(['seo']);
    const byCheck = new Map(log.entries().map(e => [e.check, e]));
    expect(byCheck.get('soft-404')?.status).toBe('not-selected');
    expect(byCheck.get('meta-noindex')?.status).toBe('not-checkable');
    expect(byCheck.get('meta-noindex')?.summary_en).toMatch(/did not run/);
  });

  it('fail comes with findings and their codes, once each; pass without', () => {
    const log = new CheckLog(ALL);
    log.record('soft-404', outcome([finding('tech.soft-404'), finding('tech.soft-404')], { status: 'pass', summary_de: 'ok', summary_en: 'ok' }));
    log.record('http-to-https', outcome([], { status: 'pass', summary_de: 'Eine 301.', summary_en: 'One 301.' }));
    const byCheck = new Map(log.entries().map(e => [e.check, e]));
    expect(byCheck.get('soft-404')).toMatchObject({ status: 'fail', findingCodes: ['tech.soft-404'], module: 'tech', point: '2' });
    expect(byCheck.get('http-to-https')).toMatchObject({ status: 'pass', findingCodes: [], summary_en: 'One 301.' });
  });

  it('a check belonging to two modules takes the one chosen', () => {
    expect(new CheckLog(['tech']).entries()[0]).toMatchObject({ check: 'script-loading', module: 'tech' });
    expect(new CheckLog(['performance']).entries()[0]).toMatchObject({ check: 'script-loading', module: 'performance' });
  });

  it('programming errors throw: twice, fail without findings, pass with findings, a finding without code, a module not chosen', () => {
    const log = new CheckLog(['tech']);
    log.record('soft-404', { status: 'pass', summary_de: '', summary_en: '' });
    expect(() => log.record('soft-404', { status: 'pass', summary_de: '', summary_en: '' })).toThrow(/twice/);
    expect(() => log.record('http-to-https', { status: 'fail', summary_de: '', summary_en: '' })).toThrow(/fail with 0/);
    expect(() => log.record('http-to-https', { status: 'pass', findings: [finding('tech.x')], summary_de: '', summary_en: '' })).toThrow(/pass with 1/);
    expect(() => log.record('http-to-https', { status: 'fail', findings: [finding(undefined)], summary_de: '', summary_en: '' })).toThrow(/no code/);
    expect(() => log.record('meta-noindex', { status: 'pass', summary_de: '', summary_en: '' })).toThrow(/none of its modules/);
  });
});
