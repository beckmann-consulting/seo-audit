import { describe, it, expect } from 'vitest';
import { parseXRobotsTag, xRobotsImpliesNoindex } from './x-robots';

describe('parseXRobotsTag', () => {
  it('returns null for undefined / empty', () => {
    expect(parseXRobotsTag(undefined)).toBeNull();
    expect(parseXRobotsTag('')).toBeNull();
    expect(parseXRobotsTag('   ')).toBeNull();
  });

  it('parses a single generic directive', () => {
    const r = parseXRobotsTag('noindex');
    expect(r).not.toBeNull();
    expect(r!.generalDirectives).toEqual(['noindex']);
    expect(r!.botSpecific).toEqual([]);
  });

  it('parses multiple comma-separated generic directives', () => {
    const r = parseXRobotsTag('noindex, nofollow');
    expect(r!.generalDirectives).toEqual(['noindex', 'nofollow']);
    expect(r!.botSpecific).toEqual([]);
  });

  it('parses a bot-prefixed directive', () => {
    const r = parseXRobotsTag('googlebot: noindex');
    expect(r!.generalDirectives).toEqual([]);
    expect(r!.botSpecific).toEqual([{ bot: 'googlebot', directives: ['noindex'] }]);
  });

  it('keeps bot context across comma-separated directives', () => {
    const r = parseXRobotsTag('googlebot: noindex, nofollow');
    expect(r!.botSpecific).toEqual([{ bot: 'googlebot', directives: ['noindex', 'nofollow'] }]);
    expect(r!.generalDirectives).toEqual([]);
  });

  it('handles a generic directive followed by a bot prefix', () => {
    const r = parseXRobotsTag('noindex, googlebot: nofollow');
    expect(r!.generalDirectives).toEqual(['noindex']);
    expect(r!.botSpecific).toEqual([{ bot: 'googlebot', directives: ['nofollow'] }]);
  });

  it('treats max-snippet/unavailable_after as keyed directives, not bot prefixes', () => {
    const r = parseXRobotsTag('max-snippet: 50, noindex');
    expect(r!.generalDirectives).toEqual(['max-snippet: 50', 'noindex']);
    expect(r!.botSpecific).toEqual([]);
  });

  it('lowercases bot names and directives', () => {
    const r = parseXRobotsTag('GoogleBot: NoIndex');
    expect(r!.botSpecific).toEqual([{ bot: 'googlebot', directives: ['noindex'] }]);
  });

  it('handles two bot prefixes in one header', () => {
    const r = parseXRobotsTag('googlebot: nofollow, otherbot: noindex, nofollow');
    expect(r!.botSpecific).toEqual([
      { bot: 'googlebot', directives: ['nofollow'] },
      { bot: 'otherbot', directives: ['noindex', 'nofollow'] },
    ]);
  });
});

describe('xRobotsImpliesNoindex', () => {
  it('returns false when null', () => {
    expect(xRobotsImpliesNoindex(null)).toBe(false);
  });

  it('returns false when no noindex anywhere', () => {
    expect(xRobotsImpliesNoindex(parseXRobotsTag('nofollow'))).toBe(false);
    expect(xRobotsImpliesNoindex(parseXRobotsTag('max-snippet: 50'))).toBe(false);
  });

  it('returns true for a generic noindex', () => {
    expect(xRobotsImpliesNoindex(parseXRobotsTag('noindex'))).toBe(true);
  });

  it('returns true for "none" (which is shorthand for noindex,nofollow)', () => {
    expect(xRobotsImpliesNoindex(parseXRobotsTag('none'))).toBe(true);
  });

  it('returns true when googlebot specifically gets noindex', () => {
    expect(xRobotsImpliesNoindex(parseXRobotsTag('googlebot: noindex'))).toBe(true);
  });

  it('returns false when only an unrelated bot is noindexed', () => {
    expect(xRobotsImpliesNoindex(parseXRobotsTag('otherbot: noindex'))).toBe(false);
  });

  it('returns true for googlebot-news / -image / -video noindex', () => {
    expect(xRobotsImpliesNoindex(parseXRobotsTag('googlebot-news: noindex'))).toBe(true);
    expect(xRobotsImpliesNoindex(parseXRobotsTag('googlebot-image: noindex'))).toBe(true);
  });
});
