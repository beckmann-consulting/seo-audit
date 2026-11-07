// Limits of the public free check (websites-27, POST /api/widget/check):
// a map whose entries expire, the rate limit per shortened client address,
// the daily cap and the concurrency slots. The clock is a parameter so the
// tests can move it; nothing here is persisted.

/** A map whose entries expire ttlMs after they were set; at most max entries, the oldest go first. */
export class TtlMap<K, V> {
  private readonly m = new Map<K, { v: V; exp: number }>();
  constructor(private readonly ttlMs: number, private readonly max: number, private readonly now: () => number = Date.now) {}

  get(k: K): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (e.exp <= this.now()) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }

  set(k: K, v: V): void {
    this.m.delete(k);
    this.m.set(k, { v, exp: this.now() + this.ttlMs });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as K);
  }

  /** Delete every expired entry (run by the sweeper, not only on access). */
  sweep(): void {
    const t = this.now();
    for (const [k, e] of this.m) if (e.exp <= t) this.m.delete(k);
  }

  /** Entries held, expired or not (for the tests and the sweeper). */
  get size(): number {
    return this.m.size;
  }
}

/** Client address shortened before it is used as a key: IPv4 to /24, IPv6 to /48. */
export function shortenAddress(ip: string): string {
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.split('.').slice(0, 3).join('.') + '.0/24';
  if (ip.includes(':')) {
    const [head] = ip.split('::');
    const groups = head.split(':').filter(Boolean);
    while (groups.length < 3) groups.push('0');
    return groups.slice(0, 3).join(':') + '::/48';
  }
  return 'unknown';
}

/** Runs per shortened address within the last hour; an entry is gone one hour after its last run. */
export class RateLimiter {
  private readonly hits: TtlMap<string, number[]>;
  constructor(private readonly perHour: number, private readonly now: () => number = Date.now) {
    this.hits = new TtlMap(60 * 60 * 1000, 50_000, now);
  }

  /** Counts a run and returns true when the address is still under the limit. */
  take(key: string): boolean {
    const hourAgo = this.now() - 60 * 60 * 1000;
    const recent = (this.hits.get(key) ?? []).filter(t => t > hourAgo);
    if (recent.length >= this.perHour) return false;
    recent.push(this.now());
    this.hits.set(key, recent);
    return true;
  }

  sweep(): void {
    this.hits.sweep();
  }

  get size(): number {
    return this.hits.size;
  }
}

/** New runs per UTC day, for all visitors together. */
export class DailyCap {
  private day = '';
  private count = 0;
  constructor(private readonly max: number, private readonly now: () => number = Date.now) {}

  take(): boolean {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.count = 0;
    }
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }
}

/** Concurrency slots: a run holds one from its start until all its work has ended. */
export class Slots {
  private used = 0;
  constructor(private readonly max: number) {}

  tryTake(): boolean {
    if (this.used >= this.max) return false;
    this.used++;
    return true;
  }

  release(): void {
    if (this.used > 0) this.used--;
  }

  get inUse(): number {
    return this.used;
  }
}
