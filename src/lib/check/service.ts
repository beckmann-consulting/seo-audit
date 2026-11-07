// The free check behind POST /api/widget/check (websites-27): input check,
// cache, limits, deadline and logging around runCheck. Kept apart from the
// Next.js route so the tests can drive it with their own clock, runner and
// transport.
//
// - Cache: the measurement per host (both languages, Prüfer-224), 24 hours
//   from the run, deleted on access and by the sweeper; a cached answer
//   starts no run, no PageSpeed call and counts for no limit.
// - Limits: 3 new runs per shortened client address and hour (entry deleted
//   one hour after its last run), 200 new runs per UTC day, 2 at a time.
// - Deadline: one AbortController per run, aborted after 60 s; it reaches
//   every request and DNS question of the run (abortableTransport) and the
//   PageSpeed call. The slot is freed in `finally`, after runCheck has
//   returned, i.e. after all its work has ended.
// - Log: no domain, no address. Only time, duration, outcome and a hash of
//   the host with a salt that changes every UTC day and lives in memory only.

import { createHash, randomBytes } from 'node:crypto';
import { DailyCap, RateLimiter, shortenAddress, Slots, TtlMap } from './limits';
import { inLanguage, normaliseHost, runCheck, type CheckMeasurement, type CheckOutcome, type CheckResult, type RunOptions } from './run-check';
import { abortableTransport } from './transport';
import type { Transport } from '@/lib/ai-visibility/safe-fetch';

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const RUN_DEADLINE_MS = 60_000;
export const SWEEP_EVERY_MS = 10 * 60 * 1000;

export interface ServiceOptions {
  now?: () => number;
  perHour?: number;
  perDay?: number;
  concurrent?: number;
  deadlineMs?: number;
  pageSpeedKey?: string;
  /** The run itself; tests replace it. */
  runner?: (host: string, o: RunOptions) => Promise<CheckOutcome>;
  /** The network of one run, bound to its signal; tests replace it. */
  transportFor?: (signal: AbortSignal) => Transport;
  log?: (line: string) => void;
}

export interface CheckRequest {
  domain: unknown;
  lang: unknown;
  clientAddress: string;
}

export type CheckResponse =
  | { status: 200; body: { ok: true; cached: boolean; result: CheckResult } }
  | { status: 400 | 422 | 429 | 503 | 504 | 500; body: { ok: false; error: string } };

export function createCheckService(o: ServiceOptions = {}) {
  const now = o.now ?? Date.now;
  const cache = new TtlMap<string, CheckMeasurement>(CACHE_TTL_MS, 1000, now);
  const perAddress = new RateLimiter(o.perHour ?? 3, now);
  const perDay = new DailyCap(o.perDay ?? 200, now);
  const slots = new Slots(o.concurrent ?? 2);
  const runner = o.runner ?? runCheck;
  const transportFor = o.transportFor ?? ((signal: AbortSignal) => abortableTransport(signal));
  const log = o.log ?? ((line: string) => console.log(line));
  const deadlineMs = o.deadlineMs ?? RUN_DEADLINE_MS;

  let saltDay = '';
  let salt = Buffer.alloc(0);
  const hostHash = (host: string) => {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (day !== saltDay) {
      saltDay = day;
      salt = randomBytes(16);
    }
    return createHash('sha256').update(salt).update(host).digest('hex').slice(0, 12);
  };

  function sweep(): void {
    cache.sweep();
    perAddress.sweep();
  }

  async function handle(req: CheckRequest): Promise<CheckResponse> {
    const lang = req.lang === 'en' ? 'en' : 'de';
    const host = typeof req.domain === 'string' ? normaliseHost(req.domain) : null;
    if (!host) return { status: 400, body: { ok: false, error: 'invalid_domain' } };

    const key = host;
    const hit = cache.get(key);
    if (hit) return { status: 200, body: { ok: true, cached: true, result: inLanguage(hit, lang) } };

    if (!slots.tryTake()) return { status: 503, body: { ok: false, error: 'busy' } };
    const started = now();
    let outcome: CheckOutcome | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    try {
      if (!perAddress.take(shortenAddress(req.clientAddress))) return { status: 429, body: { ok: false, error: 'rate_limited' } };
      if (!perDay.take()) return { status: 503, body: { ok: false, error: 'daily_limit' } };
      outcome = await runner(host, {
        signal: controller.signal,
        deadline: started + deadlineMs,
        transport: transportFor(controller.signal),
        pageSpeedKey: o.pageSpeedKey,
      });
    } catch {
      outcome = undefined;
    } finally {
      clearTimeout(timer);
      controller.abort(); // nothing of this run may outlive it
      slots.release();
    }
    if (!outcome) {
      log(`[check] ${new Date(started).toISOString()} host=${hostHash(host)} ms=${now() - started} outcome=error`);
      return { status: 500, body: { ok: false, error: 'error' } };
    }
    log(`[check] ${new Date(started).toISOString()} host=${hostHash(host)} ms=${now() - started} outcome=${outcome.ok ? 'ok' : outcome.error}`);
    if (!outcome.ok) {
      const status = outcome.error === 'timeout' ? 504 : 422;
      return { status, body: { ok: false, error: outcome.error } };
    }
    cache.set(key, outcome.result);
    return { status: 200, body: { ok: true, cached: false, result: inLanguage(outcome.result, lang) } };
  }

  return {
    handle,
    sweep,
    /** For the tests: what the service holds right now. */
    state: () => ({ cached: cache.size, addresses: perAddress.size, slotsInUse: slots.inUse }),
  };
}

export type CheckService = ReturnType<typeof createCheckService>;

/**
 * The client address as Caddy hands it over. No proxy or CDN stands before
 * Caddy (websites-27: the A record points at twb-server itself), and
 * reverse_proxy replaces X-Forwarded-For of untrusted clients with the real
 * address, so the last entry is the one Caddy set.
 */
export function clientAddressFrom(headers: { get(name: string): string | null }): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}

export const CHECK_ALLOWED_ORIGIN = 'https://beckmanndigital.com';

/** CORS for the check: only beckmanndigital.com (plus localhost while developing). */
export function checkCorsHeaders(origin: string | null, dev = process.env.NODE_ENV !== 'production'): Record<string, string> {
  const allowed = origin === CHECK_ALLOWED_ORIGIN || (dev && !!origin && /^http:\/\/localhost:\d+$/.test(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? (origin as string) : CHECK_ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
}
