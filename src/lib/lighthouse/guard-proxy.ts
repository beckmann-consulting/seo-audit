// ultimate-41, point 4: the only way out for the Chromium that Lighthouse drives (journal ultimate-41-plan.md B4).
//
// Chromium gets `--proxy-server=http://127.0.0.1:<port>` and `--proxy-bypass-list=<-loopback>`, so every request,
// loopback included, comes here: plain HTTP as an absolute-form request (`GET http://host/path`), HTTPS and
// WebSockets as CONNECT tunnels (TLS stays end to end). For each one the proxy resolves the host, refuses it when any
// of its addresses is not public (the rule of safe-fetch's checkHost) or the port is not allowed, and connects to the
// checked address (no second resolution, no rebinding). It adds no credentials and drops Proxy-* headers.
//
// There is no switch for private addresses. Tests replace the resolver and the connector through the options below;
// nothing in the environment or the audit configuration reaches them.
import * as http from 'node:http';
import * as net from 'node:net';
import * as dns from 'node:dns';
import type { Duplex } from 'node:stream';
import { isPublicAddress, type Address } from '@/lib/ai-visibility/safe-fetch';

export interface GuardProxyOptions {
  extraPorts?: number[]; // besides 80 and 443, e.g. the port of the audited URL
  resolve?: (host: string) => Promise<Address[]>;
  connect?: (address: Address, port: number) => net.Socket;
}

export interface GuardProxy {
  port: number;
  refusals: string[]; // "host:port: reason", in order
  close(): Promise<void>;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

async function defaultResolve(host: string): Promise<Address[]> {
  if (net.isIP(host)) return [{ address: host, family: net.isIP(host) as 4 | 6 }];
  const all = await dns.promises.lookup(host, { all: true, verbatim: true });
  return all.map(a => ({ address: a.address, family: a.family as 4 | 6 }));
}

function defaultConnect(address: Address, port: number): net.Socket {
  return net.connect({ host: address.address, port, family: address.family });
}

/** "host:port" of a CONNECT target, IPv6 in brackets. */
export function parseAuthority(authority: string): { host: string; port: number } | undefined {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(authority) ?? /^([^:]+):(\d+)$/.exec(authority);
  if (!m) return undefined;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1].toLowerCase(), port } : undefined;
}

export async function startGuardProxy(o: GuardProxyOptions = {}): Promise<GuardProxy> {
  const resolve = o.resolve ?? defaultResolve;
  const connect = o.connect ?? defaultConnect;
  const ports = new Set([80, 443, ...(o.extraPorts ?? [])]);
  const refusals: string[] = [];
  const sockets = new Set<Duplex>();
  const track = (s: Duplex) => { sockets.add(s); s.on('close', () => sockets.delete(s)); };

  // the checked address of a host, or the reason it is refused
  async function check(host: string, port: number): Promise<{ ok: true; address: Address } | { ok: false; reason: string }> {
    if (!ports.has(port)) return { ok: false, reason: `port ${port} not allowed` };
    const bare = host.replace(/^\[|\]$/g, '');
    let addrs: Address[];
    try { addrs = await resolve(bare); } catch { return { ok: false, reason: `${bare} does not resolve` }; }
    if (addrs.length === 0) return { ok: false, reason: `${bare} does not resolve` };
    const bad = addrs.find(a => !isPublicAddress(a.address));
    if (bad) return { ok: false, reason: `${bare} points to a non-public address (${bad.address})` };
    return { ok: true, address: addrs[0] };
  }

  const server = http.createServer(async (req, res) => {
    let target: URL;
    try { target = new URL(req.url ?? ''); } catch { res.writeHead(400).end(); return; }
    if (target.protocol !== 'http:') { res.writeHead(400).end(); return; }
    const port = Number(target.port || 80);
    const c = await check(target.hostname, port);
    if (!c.ok) {
      refusals.push(`${target.hostname}:${port}: ${c.reason}`);
      res.writeHead(403, { 'content-type': 'text/plain' }).end('refused by the audit proxy');
      return;
    }
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    const upstream = http.request({
      method: req.method, path: `${target.pathname}${target.search}`, headers,
      createConnection: () => { const s = connect(c.address, port); track(s); return s; },
    }, up => {
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
      res.writeHead(up.statusCode ?? 502, out);
      up.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });

  server.on('connection', s => track(s));

  server.on('connect', async (req: http.IncomingMessage, client: Duplex, head: Buffer) => {
    track(client);
    client.on('error', () => client.destroy());
    const a = parseAuthority(req.url ?? '');
    if (!a) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const c = await check(a.host, a.port);
    if (!c.ok) {
      refusals.push(`${a.host}:${a.port}: ${c.reason}`);
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const upstream = connect(c.address, a.port);
    track(upstream);
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => { client.destroy(); upstream.destroy(); });
    client.on('close', () => upstream.destroy());
  });

  // a protocol upgrade through a plain request (not CONNECT) is not forwarded
  server.on('upgrade', (_req, socket: Duplex) => { socket.destroy(); });

  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ok()); });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    refusals,
    close: () => new Promise<void>(done => {
      for (const s of sockets) s.destroy();
      server.close(() => done());
    }),
  };
}
