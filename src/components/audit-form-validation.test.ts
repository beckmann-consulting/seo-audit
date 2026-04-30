import { describe, it, expect } from 'vitest';
import { checkPatterns } from './audit-form-validation';

describe('checkPatterns — live regex validation', () => {
  it('returns null when both lists are empty', () => {
    expect(checkPatterns('', '')).toBeNull();
  });

  it('returns null for valid patterns in both lists', () => {
    expect(checkPatterns('/blog/\n/products/', '/admin\n\\.pdf$')).toBeNull();
  });

  it('returns the offending include pattern when include has a broken regex', () => {
    expect(checkPatterns('[unclosed', '')).toEqual({ which: 'include', pattern: '[unclosed' });
  });

  it('returns the offending exclude pattern when only exclude has a broken regex', () => {
    expect(checkPatterns('/blog/', '(badgroup')).toEqual({ which: 'exclude', pattern: '(badgroup' });
  });

  it('clears once the broken pattern is corrected (the bug we are fixing)', () => {
    // The textarea onChange runs checkPatterns on every keystroke.
    // First call mirrors "user has [unclosed in include":
    expect(checkPatterns('[unclosed', '')).toEqual({ which: 'include', pattern: '[unclosed' });
    // Second call mirrors "user removed [, leaving 'unclosed' which IS a valid regex":
    expect(checkPatterns('unclosed', '')).toBeNull();
  });

  it('checks include before exclude — priority surfaces the first error', () => {
    // Both lists have a broken pattern. Include should win because
    // the user reads top-to-bottom, left-to-right.
    expect(checkPatterns('[bad-in', '(bad-ex')).toEqual({ which: 'include', pattern: '[bad-in' });
  });

  it('skips whitespace-only lines (matches the runAudit splitLines() behaviour)', () => {
    // A line of pure whitespace is dropped, so it cannot be invalid.
    expect(checkPatterns('   \n\t\n  ', '')).toBeNull();
  });

  it('checks every non-empty line, not just the first', () => {
    // Valid first line, broken second line — must catch the second.
    expect(checkPatterns('/ok/\n[broken', '')).toEqual({ which: 'include', pattern: '[broken' });
  });

  it('reports the first broken line when multiple are broken on the include side', () => {
    expect(checkPatterns('[first\n(second', '')).toEqual({ which: 'include', pattern: '[first' });
  });
});
