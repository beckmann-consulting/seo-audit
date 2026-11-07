// The network of one free check run: like nodeTransport of safe-fetch.ts
// (connections pinned to the checked address), but every request and every
// DNS question ends when the run's signal aborts. node:http destroys the
// request and its response stream on abort, so a server that sends one byte
// every few seconds cannot keep a run alive past its deadline. Names are
// resolved with c-ares (no /etc/hosts), with a timeout, and cancelled on abort.

import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as net from 'node:net';
import { pinnedLookup, type Address, type RawResponse, type RequestInit, type Transport } from '@/lib/ai-visibility/safe-fetch';

export function abortableTransport(signal: AbortSignal, dnsTimeoutMs = 3000): Transport {
  return {
    async resolve(host: string): Promise<Address[]> {
      if (net.isIP(host)) return [{ address: host, family: net.isIP(host) as 4 | 6 }];
      if (signal.aborted) throw new Error('aborted');
      const resolver = new dns.promises.Resolver({ timeout: dnsTimeoutMs, tries: 1 });
      const cancel = () => resolver.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const [v4, v6] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
        const out: Address[] = [];
        if (v4.status === 'fulfilled') for (const a of v4.value) out.push({ address: a, family: 4 });
        if (v6.status === 'fulfilled') for (const a of v6.value) out.push({ address: a, family: 6 });
        if (out.length === 0) throw new Error(`${host} does not resolve`);
        return out;
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    request(url: URL, address: Address, init: RequestInit): Promise<RawResponse> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error('aborted'));
          return;
        }
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.request({
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: init.method,
          headers: init.headers,
          servername: net.isIP(url.hostname) ? undefined : url.hostname,
          lookup: pinnedLookup(address) as unknown as typeof dns.lookup,
          timeout: init.timeoutMs,
          signal,
        }, res => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }));
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
        if (init.body) req.write(init.body);
        req.end();
      });
    },
  };
}
