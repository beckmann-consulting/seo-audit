import { describe, expect, it } from 'vitest';
import {
  classifyAIBotRow,
  classifyLlmsTxt,
  classifyHsts,
  classifyXContentTypeOptions,
  classifyXFrameOptions,
  classifyCsp,
  classifyReferrerPolicy,
  classifyPermissionsPolicy,
  classifyMixedContent,
  classifyRedirected,
  classifyChains,
  classifyLoops,
  classifyDowngrades,
  moduleGridLayout,
} from './severity-classifier';

describe('classifyAIBotRow', () => {
  it('treats unspecified as neutral, never bad', () => {
    expect(classifyAIBotRow('unspecified')).toBe('neutral');
  });
  it('marks allowed as good and blocked as warn', () => {
    expect(classifyAIBotRow('allowed')).toBe('good');
    expect(classifyAIBotRow('blocked')).toBe('warn');
    expect(classifyAIBotRow('partial')).toBe('warn');
  });
});

describe('classifyLlmsTxt', () => {
  it('returns neutral when missing (emerging standard, rendered gray)', () => {
    expect(classifyLlmsTxt(false)).toBe('neutral');
    expect(classifyLlmsTxt(true)).toBe('good');
  });
});

describe('classifyHsts', () => {
  const sixMonths = 6 * 30 * 24 * 60 * 60;
  it('warns when missing on HTTPS', () => {
    expect(classifyHsts({})).toBe('warn');
  });
  it('warns when max-age below 6 months', () => {
    expect(classifyHsts({ hsts: 'max-age=100', hstsMaxAge: 100 })).toBe('warn');
    expect(classifyHsts({ hsts: 'max-age=...', hstsMaxAge: sixMonths - 1 })).toBe('warn');
  });
  it('passes when max-age at or above 6 months', () => {
    expect(classifyHsts({ hsts: '...', hstsMaxAge: sixMonths })).toBe('good');
    expect(classifyHsts({ hsts: '...', hstsMaxAge: 31536000 })).toBe('good');
  });
});

describe('classifyXFrameOptions', () => {
  it('passes when CSP frame-ancestors is set even without XFO header', () => {
    expect(classifyXFrameOptions({ csp: "frame-ancestors 'self'" })).toBe('good');
  });
  it('warns when both XFO and frame-ancestors are missing', () => {
    expect(classifyXFrameOptions({})).toBe('warn');
  });
  it('passes when XFO is set explicitly', () => {
    expect(classifyXFrameOptions({ xFrameOptions: 'SAMEORIGIN' })).toBe('good');
  });
});

describe('classifyCsp', () => {
  it('warns when missing (not bad — most marketing sites lack CSP)', () => {
    expect(classifyCsp({})).toBe('warn');
  });
  it('warns when CSP contains unsafe-inline or unsafe-eval', () => {
    expect(classifyCsp({ csp: "default-src 'self' 'unsafe-inline'" })).toBe('warn');
    expect(classifyCsp({ csp: "script-src 'self' 'unsafe-eval'" })).toBe('warn');
  });
  it('passes when CSP is set without unsafe-* tokens', () => {
    expect(classifyCsp({ csp: "default-src 'self'; img-src 'self' data:" })).toBe('good');
  });
});

describe('classifyPermissionsPolicy', () => {
  it('returns neutral when missing (emerging baseline, rendered gray)', () => {
    expect(classifyPermissionsPolicy({})).toBe('neutral');
    expect(classifyPermissionsPolicy({ permissionsPolicy: 'camera=()' })).toBe('good');
  });
});

describe('classifyXContentTypeOptions / Referrer / MixedContent', () => {
  it('XCTO requires nosniff value', () => {
    expect(classifyXContentTypeOptions({})).toBe('warn');
    expect(classifyXContentTypeOptions({ xContentTypeOptions: 'nosniff' })).toBe('good');
    expect(classifyXContentTypeOptions({ xContentTypeOptions: 'something-else' })).toBe('warn');
  });
  it('Referrer-Policy: presence is enough', () => {
    expect(classifyReferrerPolicy({})).toBe('warn');
    expect(classifyReferrerPolicy({ referrerPolicy: 'strict-origin-when-cross-origin' })).toBe('good');
  });
  it('Mixed content is bad (real defect)', () => {
    expect(classifyMixedContent(true)).toBe('bad');
    expect(classifyMixedContent(false)).toBe('good');
  });
});

describe('classifyRedirected', () => {
  it('treats single normalisation as good (apex→www, http→https)', () => {
    expect(classifyRedirected({ redirectedCount: 1, chainCount: 0, loopCount: 0, downgradeCount: 0 })).toBe('good');
    expect(classifyRedirected({ redirectedCount: 0, chainCount: 0, loopCount: 0, downgradeCount: 0 })).toBe('good');
  });
  it('flags loops as bad', () => {
    expect(classifyRedirected({ redirectedCount: 5, chainCount: 0, loopCount: 1, downgradeCount: 0 })).toBe('bad');
  });
  it('flags HTTPS->HTTP downgrades as bad', () => {
    expect(classifyRedirected({ redirectedCount: 5, chainCount: 0, loopCount: 0, downgradeCount: 1 })).toBe('bad');
  });
  it('returns neutral for >1 redirect without structural issues', () => {
    expect(classifyRedirected({ redirectedCount: 3, chainCount: 0, loopCount: 0, downgradeCount: 0 })).toBe('neutral');
  });
});

describe('moduleGridLayout', () => {
  it('1-4 → single row, left-aligned', () => {
    expect(moduleGridLayout(1)).toEqual({ rows: [[0]], centerLast: false });
    expect(moduleGridLayout(3)).toEqual({ rows: [[0, 1, 2]], centerLast: false });
    expect(moduleGridLayout(4)).toEqual({ rows: [[0, 1, 2, 3]], centerLast: false });
  });
  it('5 → 3+2, last centered', () => {
    expect(moduleGridLayout(5)).toEqual({ rows: [[0, 1, 2], [3, 4]], centerLast: true });
  });
  it('6 → 3+3, last not centered', () => {
    expect(moduleGridLayout(6)).toEqual({ rows: [[0, 1, 2], [3, 4, 5]], centerLast: false });
  });
  it('7 → 4+3, last centered', () => {
    expect(moduleGridLayout(7)).toEqual({ rows: [[0, 1, 2, 3], [4, 5, 6]], centerLast: true });
  });
  it('8 → 4+4, last not centered', () => {
    expect(moduleGridLayout(8)).toEqual({ rows: [[0, 1, 2, 3], [4, 5, 6, 7]], centerLast: false });
  });
  it('>8 falls back to 4-wide rows', () => {
    const layout = moduleGridLayout(11);
    expect(layout.rows).toEqual([[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10]]);
    expect(layout.centerLast).toBe(true);
  });
});
