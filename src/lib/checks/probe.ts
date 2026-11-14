// ultimate-41 (journal ultimate-41-plan.md 1.3): fetches for the new checks (made-up URL, http → https, hreflang
// targets). Redirects are followed here, step by step, each step with its own checked scope (public addresses only,
// the connection pinned to the checked address), so a chain may change scheme (http → https) and host (apex → www),
// which one scope does not allow. Every answered step is recorded with its status and Location.
//
// The audit's own headers (basic auth, custom headers) go to the exact origin of the audited URL only; the http
// variant, the www/apex counterpart and other hosts get none. Nothing starts after the deadline.
import { buildScope, safeFetch, DEFAULT_LIMITS, type Scope, type Transport } from '@/lib/ai-visibility/safe-fetch';
import { canonicalHost, registrableDomain } from '@/lib/ai-visibility/public-suffix';

export interface ProbeStep {
  url: string;
  status: number;
  location?: string;
}

export interface ProbeFinal {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export type ProbeStop = 'deadline' | 'max-hops' | 'outside' | 'refused' | 'error';

export interface ProbeResult {
  steps: ProbeStep[];
  final?: ProbeFinal; // the last answered response
  stopped?: ProbeStop; // why the chain ended before an answer that is not a redirect
  reason?: string;
  outsideUrl?: string; // a redirect target that was not fetched (another site, or `follow: 'none'`)
}

export interface ProbeOptions {
  auditUrl: string;
  auditHeaders?: Record<string, string>;
  userAgent?: string;
  transport?: Transport; // tests
  deadline: number;
  maxHops?: number;
  requestTimeoutMs?: number;
  bodyBytes?: number;
  follow?: 'site' | 'none'; // 'site': only within the registrable domain of the audited host
  scopes?: Map<string, Scope>; // one scope per origin, shared within a run
}

export const PROBE_DEFAULTS = { maxHops: 5, requestTimeoutMs: 10_000, bodyBytes: 512 * 1024 } as const;

function siteOf(host: string): string {
  const h = canonicalHost(host.toLowerCase()) ?? host.toLowerCase();
  return registrableDomain(h) ?? h;
}

/**
 * Why a step failed. A timeout counts as the deadline when the deadline is (nearly) reached: a timer set for it may
 * fire a millisecond before Date.now() gets there, so "now >= deadline" alone would call it a refusal.
 */
function stopOf(reason: string, deadline: number): ProbeStop {
  const nearDeadline = deadline - Date.now() <= 50;
  if (nearDeadline && /timed out|time budget|budget/.test(reason)) return 'deadline';
  if (Date.now() >= deadline) return 'deadline';
  if (/non-public|outside|another domain|other scheme|does not resolve/.test(reason)) return 'refused';
  return 'error';
}

export async function probeChain(startUrl: string, o: ProbeOptions): Promise<ProbeResult> {
  const steps: ProbeStep[] = [];
  const auditOrigin = new URL(o.auditUrl).origin;
  const auditSite = siteOf(new URL(o.auditUrl).hostname);
  const maxHops = o.maxHops ?? PROBE_DEFAULTS.maxHops;
  const bodyBytes = o.bodyBytes ?? PROBE_DEFAULTS.bodyBytes;
  const scopes = o.scopes ?? new Map<string, Scope>();
  let url: URL;
  try { url = new URL(startUrl); } catch { return { steps, stopped: 'error', reason: `invalid URL ${startUrl}` }; }
  let final: ProbeFinal | undefined;

  for (let hop = 0; ; hop++) {
    const left = o.deadline - Date.now();
    if (left <= 0) return { steps, final, stopped: 'deadline', reason: 'probe budget used up' };
    const requestTimeoutMs = Math.min(o.requestTimeoutMs ?? PROBE_DEFAULTS.requestTimeoutMs, left);
    let scope = scopes.get(url.origin);
    if (!scope) {
      const built = await buildScope(url.href, o.transport, { requestTimeoutMs, deadline: o.deadline });
      if (!built.ok) return { steps, final, stopped: stopOf(built.reason, o.deadline), reason: built.reason };
      scope = built.scope;
      scopes.set(url.origin, scope);
    }
    if (Date.now() >= o.deadline) return { steps, final, stopped: 'deadline', reason: 'probe budget used up' };
    const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8' };
    if (o.userAgent) headers['user-agent'] = o.userAgent;
    const r = await safeFetch(url.href, { method: 'GET', headers }, {
      scope, transport: o.transport, document: true, redirect: 'manual', truncate: true,
      limits: { ...DEFAULT_LIMITS, requestTimeoutMs, requestBytes: bodyBytes },
      budget: { bytesLeft: bodyBytes + 1, deadline: o.deadline },
      auditHeaders: url.origin === auditOrigin ? o.auditHeaders : undefined,
    });
    if (!r.ok) return { steps, final, stopped: stopOf(r.reason, o.deadline), reason: r.reason };
    const location = r.res.headers.location;
    steps.push({ url: url.href, status: r.res.status, ...(location ? { location } : {}) });
    final = { url: url.href, status: r.res.status, headers: r.res.headers, body: r.res.body };
    if (!(r.res.status >= 300 && r.res.status < 400 && location)) return { steps, final };
    let next: URL;
    try { next = new URL(location, url); } catch { return { steps, final, stopped: 'error', reason: `invalid Location ${location}` }; }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return { steps, final, stopped: 'outside', outsideUrl: next.href, reason: `scheme ${next.protocol}` };
    if ((o.follow ?? 'site') === 'none' || siteOf(next.hostname) !== auditSite) {
      return { steps, final, stopped: 'outside', outsideUrl: next.href };
    }
    if (hop + 1 >= maxHops) return { steps, final, stopped: 'max-hops', outsideUrl: next.href, reason: `more than ${maxHops} steps` };
    url = next;
  }
}
