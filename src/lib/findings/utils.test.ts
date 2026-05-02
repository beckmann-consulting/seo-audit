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

  it('applies single-finding penalty 22 / 10 / 4 / 1.5 by priority', () => {
    expect(calculateModuleScore([f({ module: 'seo', priority: 'critical' })], 'seo')).toBe(78);
    expect(calculateModuleScore([f({ module: 'seo', priority: 'important' })], 'seo')).toBe(90);
    expect(calculateModuleScore([f({ module: 'seo', priority: 'recommended' })], 'seo')).toBe(96);
    // 100 - 1.5 = 98.5 → round = 99
    expect(calculateModuleScore([f({ module: 'seo', priority: 'optional' })], 'seo')).toBe(99);
  });

  it('applies diminishing returns within a severity group (√count)', () => {
    // 4 critical → penalty = 22 × √4 = 44 → score 56
    const four = Array.from({ length: 4 }, (_, i) => f({ id: `c${i}`, priority: 'critical' }));
    expect(calculateModuleScore(four, 'seo')).toBe(56);
    // 9 important → penalty = 10 × √9 = 30 → score 70 (linear would have been 0)
    const nine = Array.from({ length: 9 }, (_, i) => f({ id: `i${i}`, priority: 'important' }));
    expect(calculateModuleScore(nine, 'seo')).toBe(70);
  });

  it('sums penalties across severity groups for mixed findings', () => {
    // 1c + 1i + 1r + 1o → 22 + 10 + 4 + 1.5 = 37.5 → score = 100 - 37.5 = 62.5 → round 63
    const findings = [
      f({ id: 'a', module: 'seo', priority: 'critical' }),
      f({ id: 'b', module: 'seo', priority: 'important' }),
      f({ id: 'c', module: 'seo', priority: 'recommended' }),
      f({ id: 'd', module: 'seo', priority: 'optional' }),
    ];
    expect(calculateModuleScore(findings, 'seo')).toBe(63);
  });

  it('clamps catastrophic results at 0', () => {
    // 10 of each → penalty ≈ (22+10+4+1.5) × √10 ≈ 118.6 → clamped to 0
    const findings = [
      ...Array.from({ length: 10 }, (_, i) => f({ id: `c${i}`, priority: 'critical' })),
      ...Array.from({ length: 10 }, (_, i) => f({ id: `i${i}`, priority: 'important' })),
      ...Array.from({ length: 10 }, (_, i) => f({ id: `r${i}`, priority: 'recommended' })),
      ...Array.from({ length: 10 }, (_, i) => f({ id: `o${i}`, priority: 'optional' })),
    ];
    expect(calculateModuleScore(findings, 'seo')).toBe(0);
  });

  it('only counts findings of the requested module', () => {
    const findings = [
      f({ id: 'f1', module: 'seo', priority: 'critical' }),
      f({ id: 'f2', module: 'tech', priority: 'critical' }),
    ];
    expect(calculateModuleScore(findings, 'seo')).toBe(78);
    expect(calculateModuleScore(findings, 'tech')).toBe(78);
  });

  it('caps the score at maxPossible override', () => {
    // No findings + maxPossible = 80 → score should be 80, not 100
    expect(calculateModuleScore([], 'seo', 80)).toBe(80);
    // 1 critical against maxPossible = 80 → 80 - 22 = 58
    expect(calculateModuleScore([f({ module: 'seo', priority: 'critical' })], 'seo', 80)).toBe(58);
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
