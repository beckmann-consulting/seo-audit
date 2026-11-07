import { describe, expect, it } from 'vitest';
import { DailyCap, RateLimiter, shortenAddress, Slots, TtlMap } from './limits';

const HOUR = 60 * 60 * 1000;

describe('TtlMap', () => {
  it('forgets an entry at its expiry and the sweeper deletes it', () => {
    let t = 0;
    const m = new TtlMap<string, number>(24 * HOUR, 10, () => t);
    m.set('a', 1);
    t = 24 * HOUR - 1;
    expect(m.get('a')).toBe(1);
    t = 24 * HOUR;
    m.sweep();
    expect(m.size).toBe(0);
    expect(m.get('a')).toBeUndefined();
  });

  it('drops the oldest entry beyond its maximum', () => {
    const m = new TtlMap<string, number>(HOUR, 2, () => 0);
    m.set('a', 1);
    m.set('b', 2);
    m.set('c', 3);
    expect(m.get('a')).toBeUndefined();
    expect(m.size).toBe(2);
  });
});

describe('RateLimiter', () => {
  it('allows 3 runs per hour and deletes the address entry one hour after the last run', () => {
    let t = 0;
    const r = new RateLimiter(3, () => t);
    expect([r.take('k'), r.take('k'), r.take('k'), r.take('k')]).toEqual([true, true, true, false]);
    t = HOUR - 1;
    r.sweep();
    expect(r.size).toBe(1);
    t = HOUR;
    r.sweep();
    expect(r.size).toBe(0);
    expect(r.take('k')).toBe(true);
  });
});

describe('DailyCap and Slots', () => {
  it('counts per UTC day', () => {
    let t = Date.UTC(2026, 10, 7, 23, 0);
    const c = new DailyCap(2, () => t);
    expect([c.take(), c.take(), c.take()]).toEqual([true, true, false]);
    t = Date.UTC(2026, 10, 8, 0, 1);
    expect(c.take()).toBe(true);
  });

  it('hands out at most the given number of slots', () => {
    const s = new Slots(2);
    expect([s.tryTake(), s.tryTake(), s.tryTake()]).toEqual([true, true, false]);
    s.release();
    expect(s.inUse).toBe(1);
  });
});

describe('shortenAddress', () => {
  it('keeps /24 of IPv4 and /48 of IPv6', () => {
    expect(shortenAddress('203.0.113.77')).toBe('203.0.113.0/24');
    expect(shortenAddress('::ffff:198.51.100.9')).toBe('198.51.100.0/24');
    expect(shortenAddress('2001:db8:abcd:12::1')).toBe('2001:db8:abcd::/48');
    expect(shortenAddress('unknown')).toBe('unknown');
  });
});
