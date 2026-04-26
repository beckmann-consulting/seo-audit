import { describe, it, expect } from 'vitest';
import { calculateModuleScore, findingImpactScore, estimateScoreGain, getTopFindings } from './utils';
import type { Finding } from '@/types';

function f(partial: Partial<Finding>): Finding {
  return {
    id: partial.id ?? 'fX',
    priority: partial.priority ?? 'recommended',
    module: partial.module ?? 'seo',
    effort: partial.effort ?? 'low',
    impact: partial.impact ?? 'medium',
    title_de: 't', title_en: 't',
    description_de: 'd', description_en: 'd',
    recommendation_de: 'r', recommendation_en: 'r',
    ...partial,
  };
}

describe('calculateModuleScore', () => {
  it('returns 100 with no findings', () => {
    expect(calculateModuleScore([], 'seo')).toBe(100);
  });

  it('applies penalty 25 / 12 / 5 / 2 by priority', () => {
    expect(calculateModuleScore([f({ module: 'seo', priority: 'critical' })], 'seo')).toBe(75);
    expect(calculateModuleScore([f({ module: 'seo', priority: 'important' })], 'seo')).toBe(88);
    expect(calculateModuleScore([f({ module: 'seo', priority: 'recommended' })], 'seo')).toBe(95);
    expect(calculateModuleScore([f({ module: 'seo', priority: 'optional' })], 'seo')).toBe(98);
  });

  it('clamps at 0', () => {
    const findings = Array.from({ length: 5 }, (_, i) => f({ id: `f${i}`, priority: 'critical' }));
    expect(calculateModuleScore(findings, 'seo')).toBe(0);
  });

  it('only counts findings of the requested module', () => {
    const findings = [
      f({ id: 'f1', module: 'seo', priority: 'critical' }),
      f({ id: 'f2', module: 'tech', priority: 'critical' }),
    ];
    expect(calculateModuleScore(findings, 'seo')).toBe(75);
    expect(calculateModuleScore(findings, 'tech')).toBe(75);
  });
});

describe('estimateScoreGain', () => {
  it('mirrors the penalty values', () => {
    expect(estimateScoreGain(f({ priority: 'critical' }))).toBe(25);
    expect(estimateScoreGain(f({ priority: 'important' }))).toBe(12);
    expect(estimateScoreGain(f({ priority: 'recommended' }))).toBe(5);
    expect(estimateScoreGain(f({ priority: 'optional' }))).toBe(2);
  });
});

describe('findingImpactScore', () => {
  it('multiplies priority base by module weight', () => {
    expect(findingImpactScore(f({ priority: 'critical', module: 'seo' }))).toBe(150);
    expect(findingImpactScore(f({ priority: 'critical', module: 'legal' }))).toBe(100);
  });
});

describe('getTopFindings', () => {
  it('returns highest-impact first with id tie-break', () => {
    const findings = [
      f({ id: 'f3', priority: 'recommended', module: 'seo' }),
      f({ id: 'f1', priority: 'critical', module: 'legal' }),
      f({ id: 'f2', priority: 'critical', module: 'seo' }),
    ];
    const top = getTopFindings(findings, 2);
    expect(top.map(t => t.id)).toEqual(['f2', 'f1']);
  });
});
