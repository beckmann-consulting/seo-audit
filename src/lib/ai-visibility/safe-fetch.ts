// Fetching for the local render of check 5, with no network of Chromium's
// own (plan, check 5; Codex F-003 of round 2 and the rounds after it):
//
// - Only the audited host and its www or apex counterpart, only http and
//   https, only the port of the audited URL. For the local render also the
//   further hosts of the audited host's registrable domain (Public Suffix
//   List, ultimate-40b), at most EXTRA_HOST_LIMIT of them, under the same
//   rules; the audit's own headers still go to the audited origin only.
// - Every A and AAAA address of a host is resolved once; if any of them is
//   not public (loopback, private, link-local, CGNAT, ULA, multicast,
//   unspecified, IPv4 in IPv6, documentation, reserved), the host is
//   refused. The connection goes to the checked address through the lookup
//   option of node:http/node:https, so a second DNS answer cannot rebind it.
// - Only the document request follows redirects (GET or HEAD, at most 5,
//   every step checked); any other request stops at its first redirect
//   without contacting the target.
// - Accept-Encoding: identity; a compressed answer is unpacked as a stream,
//   and the unpacked bytes count against the limits.
// - The transport (resolve, request) is a parameter: only tests pass one of
//   their own. There is no switch for private addresses.

import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { canonicalHost, isPublicSuffix, registrableDomain } from './public-suffix';

export interface Address { address: string; family: 4 | 6 }

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

export interface RequestInit {
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
}

export interface Transport {
  resolve(host: string): Promise<Address[]>;
  request(url: URL, address: Address, init: RequestInit): Promise<RawResponse>;
}

export interface Limits {
  requestTimeoutMs: number;
  requestBytes: number;
  pageRequests: number;
  pageBytes: number;
  pageTimeMs: number;
  redirects: number;
}

export const DEFAULT_LIMITS: Limits = {
  requestTimeoutMs: 10_000,
  requestBytes: 5 * 1024 * 1024,
  pageRequests: 40,
  pageBytes: 15 * 1024 * 1024,
  pageTimeMs: 20_000,
  redirects: 5,
};

// ------------------------------------------------------------
//  Public addresses only
// ------------------------------------------------------------

// Two lists: Node checks an IPv4 address against IPv6 rules in its mapped
// form, so ::ffff:0:0/96 in one list would block every IPv4 address.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as [string, number][]) BLOCKED_V4.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as [string, number][]) BLOCKED_V6.addSubnet(a, p, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  return family === 4 ? !BLOCKED_V4.check(address, 'ipv4') : !BLOCKED_V6.check(address, 'ipv6');
}

// ------------------------------------------------------------
//  The production transport
// ------------------------------------------------------------

/**
 * A lookup that always answers with the checked address. Node asks with
 * { all: true } (happy eyeballs) and then wants a list; otherwise one
 * address and its family.
 */
export function pinnedLookup(address: Address) {
  return (_hostname: string, options: { all?: boolean } | number | undefined, cb: (...args: unknown[]) => void) => {
    if (typeof options === 'object' && options?.all) cb(null, [{ address: address.address, family: address.family }]);
    else cb(null, address.address, address.family);
  };
}

export const nodeTransport: Transport = {
  async resolve(host: string): Promise<Address[]> {
    if (net.isIP(host)) return [{ address: host, family: net.isIP(host) as 4 | 6 }];
    const all = await dns.promises.lookup(host, { all: true, verbatim: true });
    return all.map(a => ({ address: a.address, family: a.family as 4 | 6 }));
  },
  request(url: URL, address: Address, init: RequestInit): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers: init.headers,
        servername: net.isIP(url.hostname) ? undefined : url.hostname,
        // pinned: the connection goes to the address that was checked
        lookup: pinnedLookup(address) as unknown as typeof dns.lookup,
        timeout: init.timeoutMs,
      }, res => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', reject);
      if (init.body) req.write(init.body);
      req.end();
    });
  },
};

// ------------------------------------------------------------
//  Scope: allowed hosts with checked addresses
// ------------------------------------------------------------

export interface Scope {
  scheme: 'http:' | 'https:';
  port: string; // as in URL.port ('' for the default)
  hosts: Map<string, Address>; // the audited host and its www or apex counterpart -> the checked address
  auditOrigin: string; // the origin of the audited URL: the audit's own headers go there only
  // ultimate-40b: hosts of the same registrable domain (Public Suffix List), checked on first use;
  // null when the audited host has none (IP, public suffix, no listed rule): then only `hosts` count
  site: string | null;
  extra: Map<string, HostEntry>; // further hosts of the site: one entry each, final once decided
  extraLimit: number; // further hosts per run; a slot is taken before the host is resolved
  transport: Transport;
  requestTimeoutMs: number; // the longest a resolution may take
}

export type HostEntry =
  | { state: 'pending'; done: Promise<void> }
  | { state: 'allowed'; address: Address }
  | { state: 'refused'; reason: string };

export const EXTRA_HOST_LIMIT = 10;

export type ScopeResult = { ok: true; scope: Scope } | { ok: false; reason: string };

/** Every address of a host resolved; refused if there is none or one of them is not public. */
async function checkHost(transport: Transport, host: string): Promise<{ ok: true; address: Address } | { ok: false; reason: string }> {
  let addrs: Address[];
  try { addrs = await transport.resolve(host); } catch { return { ok: false, reason: `${host} does not resolve` }; }
  if (addrs.length === 0) return { ok: false, reason: `${host} does not resolve` };
  const bad = addrs.find(a => !isPublicAddress(a.address));
  if (bad) return { ok: false, reason: `${host} points to a non-public address (${bad.address})` };
  return { ok: true, address: addrs[0] };
}

/**
 * The allowed hosts of an audit: its host and the www or apex counterpart, each only with public
 * addresses; with `subdomains` (the local render, ultimate-40b) also the further hosts of its
 * registrable domain, checked when first asked for (admit).
 */
export async function buildScope(auditUrl: string, transport: Transport = nodeTransport, opts: { subdomains?: boolean; requestTimeoutMs?: number } = {}): Promise<ScopeResult> {
  let u: URL;
  try { u = new URL(auditUrl); } catch { return { ok: false, reason: 'invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `scheme ${u.protocol} not allowed` };
  const host = u.hostname.toLowerCase();
  const ip = net.isIP(host.replace(/^\[|\]$/g, '')) !== 0;
  if (!ip && !canonicalHost(host)) return { ok: false, reason: `host ${host} not supported (trailing dot or invalid name)` };
  const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
  const hosts = new Map<string, Address>();
  for (const h of ip ? [host] : [host, twin]) {
    const r = await checkHost(transport, h);
    if (!r.ok) {
      if (h === host) return { ok: false, reason: r.reason };
      continue; // the counterpart may not exist; never allow one that points inwards
    }
    hosts.set(h, r.address);
  }
  return { ok: true, scope: {
    scheme: u.protocol as Scope['scheme'], port: u.port, hosts, auditOrigin: u.origin,
    site: opts.subdomains && !ip ? registrableDomain(host) : null,
    extra: new Map(), extraLimit: EXTRA_HOST_LIMIT, transport,
    requestTimeoutMs: opts.requestTimeoutMs ?? DEFAULT_LIMITS.requestTimeoutMs,
  } };
}

export type AdmitResult = { ok: true; url: URL; address: Address } | { ok: false; reason: string };

/**
 * Whether a URL may be fetched, and the checked address to pin it to.
 * Scheme and port must be the audit's. The audited host and its counterpart
 * are allowed as before; a further host only when its registrable domain is
 * the audit's. Such a host takes one of `extraLimit` slots before it is
 * resolved (refused and failed hosts keep theirs), concurrent requests share
 * one resolution, and the resolution ends at the earlier of the page's
 * deadline and the request timeout: then the host is refused for the run and
 * a late answer is dropped.
 */
export async function admit(scope: Scope, raw: string, deadline: number): Promise<AdmitResult> {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: `invalid URL ${raw}` }; }
  if (u.protocol !== scope.scheme || u.port !== scope.port) return { ok: false, reason: `other scheme or port: ${u.origin}` };
  const name = u.hostname.toLowerCase();
  const known = scope.hosts.get(name);
  if (known) return { ok: true, url: u, address: known };
  const host = canonicalHost(name);
  if (!host || net.isIP(host)) return { ok: false, reason: `outside the audited host: ${name}` };
  if (!scope.site || registrableDomain(host) !== scope.site) return { ok: false, reason: `another domain: ${host}` };
  let entry = scope.extra.get(host);
  if (!entry) {
    let used = 0;
    for (const e of scope.extra.values()) if (!(e.state === 'refused' && e.reason.startsWith('more than'))) used++;
    if (used >= scope.extraLimit) {
      entry = { state: 'refused', reason: `more than ${scope.extraLimit} further hosts of ${scope.site}` };
      scope.extra.set(host, entry);
    } else {
      // the slot is taken now, before the resolution
      let settle!: () => void;
      const done = new Promise<void>(r => { settle = r; });
      const pending: HostEntry = { state: 'pending', done };
      scope.extra.set(host, pending);
      // the effective end of the resolution; an answer after it never allows the host, even when its
      // promise runs before the timer that would refuse it (Codex, review of 58d270e)
      const until = Math.min(deadline, Date.now() + scope.requestTimeoutMs);
      const timedOut: HostEntry = { state: 'refused', reason: `resolution of ${host} timed out` };
      const decide = (e: HostEntry) => {
        if (scope.extra.get(host) !== pending) return; // decided already: a late answer changes nothing
        scope.extra.set(host, e.state === 'allowed' && Date.now() >= until ? timedOut : e);
        settle();
      };
      if (Date.now() >= until) {
        decide(timedOut); // no time left: not resolved at all
        return { ok: false, reason: timedOut.reason };
      }
      const timer = setTimeout(() => decide(timedOut), until - Date.now());
      checkHost(scope.transport, host).then(
        r => decide(r.ok ? { state: 'allowed', address: r.address } : { state: 'refused', reason: r.reason }),
        () => decide({ state: 'refused', reason: `${host} does not resolve` }),
      ).finally(() => clearTimeout(timer));
      entry = pending;
    }
  }
  if (entry.state === 'pending') {
    await entry.done;
    entry = scope.extra.get(host) as HostEntry;
  }
  if (entry.state === 'allowed') return { ok: true, url: u, address: entry.address };
  if (entry.state === 'refused') return { ok: false, reason: entry.reason };
  return { ok: false, reason: `resolution of ${host} not decided` };
}

// ------------------------------------------------------------
//  Headers, cookies, bodies
// ------------------------------------------------------------

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'accept-encoding', 'content-length']);
const FORWARD = new Set(['accept', 'accept-language', 'content-type', 'cookie', 'origin', 'referer', 'x-requested-with', 'user-agent', 'authorization']);

/** The end-to-end headers of a page request that go on to the site. */
export function forwardHeaders(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key.startsWith('proxy-') || key.startsWith(':')) continue;
    if (FORWARD.has(key) || key.startsWith('x-')) out[key] = v;
  }
  out['accept-encoding'] = 'identity';
  return out;
}

/**
 * The audit's own headers (basic auth, custom headers): only for the audited
 * origin, never for its www or apex counterpart, and filtered like every
 * other header, so they cannot set Host, Accept-Encoding or a length.
 */
export function auditHeadersFor(url: URL, scope: Scope, audit?: Record<string, string>): Record<string, string> {
  if (!audit || url.origin !== scope.auditOrigin) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(audit)) {
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key.startsWith('proxy-') || key.startsWith(':')) continue;
    out[key] = v;
  }
  return out;
}

// ------------------------------------------------------------
//  A cookie jar for the document's redirect chain (RFC 6265, the parts a
//  browser needs here): Domain, Path, Secure, HttpOnly, Expires, Max-Age,
//  SameSite; host-only without Domain. Its cookies go to Chromium with all
//  their attributes.
// ------------------------------------------------------------

export interface JarCookie {
  name: string;
  value: string;
  domain: string; // without a leading dot
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires: number; // seconds since the epoch, -1 for a session cookie
  sameSite?: 'Strict' | 'Lax' | 'None';
}

function defaultPath(url: URL): string {
  const p = url.pathname;
  if (!p.startsWith('/') || p.lastIndexOf('/') === 0) return '/';
  return p.slice(0, p.lastIndexOf('/'));
}

function domainMatch(host: string, domain: string): boolean {
  return host === domain || (host.endsWith(`.${domain}`) && !net.isIP(host));
}

/** The request host as the jar compares it: canonical, or lower case for an IP address. */
function jarHost(url: URL): string {
  const h = url.hostname.toLowerCase();
  return canonicalHost(h) ?? h;
}

function pathMatch(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

export class CookieJar {
  private cookies: JarCookie[] = [];
  constructor(private now: () => number = () => Date.now()) {}

  setFrom(url: URL, header: string): void {
    const parts = header.split(';');
    const first = parts.shift() ?? '';
    const eq = first.indexOf('=');
    if (eq <= 0) return;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const host = jarHost(url);
    let domain = host;
    let hostOnly = true;
    let path = defaultPath(url);
    let secure = false;
    let httpOnly = false;
    let expires = -1;
    let maxAge: number | undefined;
    let sameSite: JarCookie['sameSite'];
    for (const raw of parts) {
      const i = raw.indexOf('=');
      const k = (i < 0 ? raw : raw.slice(0, i)).trim().toLowerCase();
      const v = i < 0 ? '' : raw.slice(i + 1).trim();
      if (k === 'domain' && v) {
        const d = canonicalHost(v.replace(/^\./, ''));
        if (!d) return; // no valid domain: refused
        if (isPublicSuffix(d)) {
          // RFC 6265 5.3 step 5: a public suffix only as the request host itself, then host-only
          if (d !== host) return;
          domain = host;
          hostOnly = true;
          continue;
        }
        if (!domainMatch(host, d)) return; // a cookie for a domain the host is not in: refused
        domain = d;
        hostOnly = false;
      } else if (k === 'path' && v.startsWith('/')) path = v;
      else if (k === 'secure') secure = true;
      else if (k === 'httponly') httpOnly = true;
      else if (k === 'expires') { const t = Date.parse(v); if (!Number.isNaN(t)) expires = Math.floor(t / 1000); }
      else if (k === 'max-age' && /^-?\d+$/.test(v)) maxAge = parseInt(v, 10);
      else if (k === 'samesite') { const x = v.toLowerCase(); sameSite = x === 'strict' ? 'Strict' : x === 'none' ? 'None' : 'Lax'; }
    }
    if (maxAge !== undefined) expires = maxAge <= 0 ? 0 : Math.floor(this.now() / 1000) + maxAge;
    this.cookies = this.cookies.filter(c => !(c.name === name && c.domain === domain && c.path === path));
    if (expires === 0 || (expires > 0 && expires * 1000 <= this.now())) return; // deleted or already expired
    this.cookies.push({ name, value, domain, hostOnly, path, secure, httpOnly, expires, ...(sameSite ? { sameSite } : {}) });
  }

  /** The Cookie header a browser sends to this URL, or '' for none. */
  header(url: URL): string {
    const host = jarHost(url);
    const now = this.now() / 1000;
    return this.cookies
      .filter(c => (c.hostOnly ? host === c.domain : domainMatch(host, c.domain)))
      .filter(c => pathMatch(url.pathname || '/', c.path))
      .filter(c => !c.secure || url.protocol === 'https:')
      .filter(c => c.expires === -1 || c.expires > now)
      .sort((a, b) => b.path.length - a.path.length)
      .map(c => `${c.name}=${c.value}`)
      .join('; ');
  }

  /** The cookies in the form Playwright's context.addCookies takes. */
  forPlaywright(): { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }[] {
    return this.cookies.map(c => ({
      name: c.name, value: c.value,
      domain: c.hostOnly ? c.domain : `.${c.domain}`,
      path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
      ...(c.sameSite ? { sameSite: c.sameSite } : {}),
    }));
  }

  get size(): number { return this.cookies.length; }
}

/** Response headers for route.fulfill: without the encoding and length of the source. */
export function fulfillHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const key = k.toLowerCase();
    if (v === undefined || key === 'content-encoding' || key === 'content-length' || key === 'transfer-encoding' || HOP_BY_HOP.has(key)) continue;
    out[key] = Array.isArray(v) ? v.join(key === 'set-cookie' ? '\n' : ', ') : v;
  }
  return out;
}

// ------------------------------------------------------------
//  Reading a body within the limits, unpacked
// ------------------------------------------------------------

export class LimitError extends Error {}

export interface Budget { bytesLeft: number; deadline: number }

export async function readBody(res: RawResponse, perRequest: number, budget: Budget, truncate = false): Promise<Buffer> {
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
  let stream: Readable = res.body;
  if (enc === 'gzip' || enc === 'x-gzip') stream = res.body.pipe(zlib.createGunzip());
  else if (enc === 'deflate') stream = res.body.pipe(zlib.createInflate());
  else if (enc === 'br') stream = res.body.pipe(zlib.createBrotliDecompress());
  else if (enc && enc !== 'identity') throw new LimitError(`unknown content-encoding ${enc}`);
  const chunks: Buffer[] = [];
  let n = 0;
  try {
    for await (const chunk of stream) {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (truncate && n + b.length >= perRequest) {
        // keep the first perRequest bytes and stop reading (llms.txt needs its start only)
        chunks.push(b.subarray(0, perRequest - n));
        n = perRequest;
        break;
      }
      n += b.length;
      if (n > perRequest) throw new LimitError(`response over ${perRequest} bytes (unpacked)`);
      if (n > budget.bytesLeft) throw new LimitError('page over its byte budget (unpacked)');
      if (Date.now() > budget.deadline) throw new LimitError('page over its time budget');
      chunks.push(b);
    }
  } finally {
    res.body.destroy();
    if (stream !== res.body) stream.destroy();
  }
  budget.bytesLeft -= n;
  return Buffer.concat(chunks);
}

// ------------------------------------------------------------
//  The fetch
// ------------------------------------------------------------

export interface SafeResponse {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

export type SafeResult = { ok: true; res: SafeResponse } | { ok: false; reason: string };

export interface SafeFetchOptions {
  scope: Scope;
  transport?: Transport;
  limits?: Limits;
  budget: Budget;
  document: boolean;
  auditHeaders?: Record<string, string>; // basic auth and custom headers of the audit, for the audited origin only
  jar?: CookieJar; // the document's redirect chain: cookies of each step go to the next
  truncate?: boolean; // read only the first limits.requestBytes bytes instead of failing beyond them
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host;
}

export async function safeFetch(rawUrl: string, init: { method: string; headers: Record<string, string>; body?: Buffer }, o: SafeFetchOptions): Promise<SafeResult> {
  const transport = o.transport ?? nodeTransport;
  const limits = o.limits ?? DEFAULT_LIMITS;
  const method = init.method.toUpperCase();
  if (!['GET', 'HEAD', 'POST'].includes(method)) return { ok: false, reason: `method ${method} not reproducible` };
  const first = await admit(o.scope, rawUrl, o.budget.deadline);
  if (!first.ok) return { ok: false, reason: first.reason };
  let url = first.url;
  let address = first.address;
  const startOrigin = url;
  let pageHeaders = forwardHeaders(init.headers);
  for (let hop = 0; ; hop++) {
    if (Date.now() > o.budget.deadline) return { ok: false, reason: 'page over its time budget' };
    const headers: Record<string, string> = { ...pageHeaders, ...auditHeadersFor(url, o.scope, o.auditHeaders) };
    const jarCookie = o.jar?.header(url);
    if (jarCookie) headers.cookie = headers.cookie ? `${headers.cookie}; ${jarCookie}` : jarCookie;
    let res: RawResponse;
    try {
      res = await transport.request(url, address, { method, headers, body: method === 'POST' ? init.body : undefined, timeoutMs: Math.min(limits.requestTimeoutMs, Math.max(1, o.budget.deadline - Date.now())) });
    } catch (err) {
      return { ok: false, reason: `request failed: ${String((err as Error).message ?? err)}` };
    }
    const sc = res.headers['set-cookie'];
    if (o.jar) for (const c of Array.isArray(sc) ? sc : sc ? [sc] : []) o.jar.setFrom(url, c);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      res.body.destroy();
      if (!o.document || method === 'POST') return { ok: false, reason: `redirect of a ${o.document ? 'POST' : 'resource'} not followed (${res.status})` };
      if (hop >= limits.redirects) return { ok: false, reason: 'too many redirects' };
      const step = await admit(o.scope, new URL(String(res.headers.location), url).href, o.budget.deadline);
      if (!step.ok) return { ok: false, reason: `redirect refused: ${step.reason}` };
      const next = step.url;
      if (!sameOrigin(next, startOrigin)) {
        // a change of origin (also www against apex): no cookie or authorization of the page request; the
        // audit's headers follow the audited origin only, the jar's cookies their own domain rules
        pageHeaders = forwardHeaders(Object.fromEntries(Object.entries(init.headers).filter(([k]) => !['cookie', 'authorization'].includes(k.toLowerCase()))));
      }
      url = next;
      address = step.address;
      continue;
    }
    let body: Buffer;
    try {
      body = method === 'HEAD' ? Buffer.alloc(0) : await readBody(res, limits.requestBytes, o.budget, o.truncate);
    } catch (err) {
      return { ok: false, reason: String((err as Error).message ?? err) };
    }
    return { ok: true, res: { finalUrl: url.href, status: res.status, headers: fulfillHeaders(res.headers), body } };
  }
}
