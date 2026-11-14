// ultimate-41, point 4: the guard proxy of the local Lighthouse run. The resolver and the connector are replaced
// through the proxy's options: "public.example" resolves to a public address, which the connector leads to a test
// server on loopback. Nothing in the proxy itself allows loopback.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import type { Address } from '@/lib/ai-visibility/safe-fetch';
import { startGuardProxy, parseAuthority, type GuardProxy } from './guard-proxy';

const PUBLIC: Address = { address: '93.184.215.14', family: 4 };
const DNS: Record<string, Address[]> = {
  'public.example': [PUBLIC],
  'mixed.example': [PUBLIC, { address: '10.0.0.1', family: 4 }],
  'intern.example': [{ address: '192.168.1.10', family: 4 }],
};

let web: http.Server;
let tcp: net.Server;
let webPort = 0;
let tcpPort = 0;
let seen: { path?: string; headers?: http.IncomingHttpHeaders } = {};
const connects: string[] = [];
let proxy: GuardProxy;

function resolve(host: string): Promise<Address[]> {
  if (net.isIP(host)) return Promise.resolve([{ address: host, family: net.isIP(host) as 4 | 6 }]);
  const a = DNS[host];
  return a ? Promise.resolve(a) : Promise.reject(new Error('ENOTFOUND'));
}

// only the public test address is led to the local servers; anything else would fail loudly
function connect(address: Address, port: number): net.Socket {
  connects.push(`${address.address}:${port}`);
  if (address.address !== PUBLIC.address) throw new Error(`connector asked for ${address.address}`);
  return net.connect({ host: '127.0.0.1', port: port === 443 ? tcpPort : webPort });
}

beforeAll(async () => {
  web = http.createServer((req, res) => { seen = { path: req.url, headers: req.headers }; res.end('hello'); });
  tcp = net.createServer(s => s.on('data', d => s.write(`echo:${d.toString()}`)));
  await new Promise<void>(r => web.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>(r => tcp.listen(0, '127.0.0.1', () => r()));
  webPort = (web.address() as net.AddressInfo).port;
  tcpPort = (tcp.address() as net.AddressInfo).port;
  proxy = await startGuardProxy({ resolve, connect });
});

afterAll(async () => {
  await proxy.close();
  await new Promise<void>(r => web.close(() => r()));
  await new Promise<void>(r => tcp.close(() => r()));
});

function viaProxy(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const u = new URL(url);
    const req = http.request({ host: '127.0.0.1', port: proxy.port, path: url, headers: { host: u.host, ...headers } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

function tunnel(authority: string): Promise<{ status: number; echo?: string }> {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port: proxy.port, method: 'CONNECT', path: authority });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); ok({ status: res.statusCode ?? 0 }); return; }
      socket.once('data', d => { socket.destroy(); ok({ status: 200, echo: d.toString() }); });
      socket.write('ping');
    });
    req.on('response', res => ok({ status: res.statusCode ?? 0 }));
    req.on('error', fail);
    req.end();
  });
}

describe('guard proxy (ultimate-41, point 4)', () => {
  it('a plain HTTP request to a public host goes through, to exactly the checked address, without Proxy-Authorization', async () => {
    connects.length = 0;
    const r = await viaProxy('http://public.example/a?b=1', { 'proxy-authorization': 'Basic eDp5', 'x-keep': '1' });
    expect(r).toEqual({ status: 200, body: 'hello' });
    expect(connects).toEqual(['93.184.215.14:80']);
    expect(seen.path).toBe('/a?b=1');
    expect(seen.headers?.['proxy-authorization']).toBeUndefined();
    expect(seen.headers?.['x-keep']).toBe('1');
  });

  it('a CONNECT tunnel to a public host goes through', async () => {
    connects.length = 0;
    expect(await tunnel('public.example:443')).toEqual({ status: 200, echo: 'echo:ping' });
    expect(connects).toEqual(['93.184.215.14:443']);
  });

  it('loopback, private, link-local and a host with one private address are refused, for HTTP and CONNECT', async () => {
    connects.length = 0;
    const before = proxy.refusals.length;
    for (const host of ['127.0.0.1', '[::1]', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', 'mixed.example', 'intern.example']) {
      expect((await viaProxy(`http://${host}/`)).status, host).toBe(403);
      expect((await tunnel(`${host}:443`)).status, host).toBe(403);
    }
    expect(connects).toEqual([]);
    expect(proxy.refusals.length - before).toBe(16);
    expect(proxy.refusals.some(r => r.startsWith('127.0.0.1:80: 127.0.0.1 points to a non-public address'))).toBe(true);
    expect(proxy.refusals.some(r => /mixed\.example:443: .*10\.0\.0\.1/.test(r))).toBe(true);
  });

  it('other ports are refused unless named', async () => {
    connects.length = 0;
    expect((await viaProxy('http://public.example:8080/')).status).toBe(403);
    expect((await tunnel('public.example:22')).status).toBe(403);
    expect(connects).toEqual([]);
    const extra = await startGuardProxy({ resolve, connect: () => net.connect({ host: '127.0.0.1', port: webPort }), extraPorts: [8080] });
    try {
      const r = await new Promise<number>((ok, fail) => {
        const req = http.request({ host: '127.0.0.1', port: extra.port, path: 'http://public.example:8080/x', headers: { host: 'public.example:8080' } }, res => { res.resume(); ok(res.statusCode ?? 0); });
        req.on('error', fail);
        req.end();
      });
      expect(r).toBe(200);
    } finally {
      await extra.close();
    }
  });

  it('parseAuthority', () => {
    expect(parseAuthority('example.com:443')).toEqual({ host: 'example.com', port: 443 });
    expect(parseAuthority('[::1]:443')).toEqual({ host: '::1', port: 443 });
    expect(parseAuthority('example.com')).toBeUndefined();
    expect(parseAuthority('example.com:0')).toBeUndefined();
  });
});
