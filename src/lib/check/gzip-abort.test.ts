// Prüfer-224: an aborted request whose gzip body is still incomplete must end
// readBody too; before, the decompressor stayed open (pipe() does not pass the
// end of the response on) and the run never reached its finally.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { readBody, type Transport } from '@/lib/ai-visibility/safe-fetch';
import { abortableTransport } from './transport';
import { createCheckService } from './service';
import { runCheck } from './run-check';

const PAGE = gzipSync(Buffer.from(`<html><head><title>x</title></head><body>${'Text '.repeat(5000)}</body></html>`));

let server: Server;
let port = 0;
beforeAll(async () => {
  // a real HTTP server: sends half of a gzip body, then keeps the connection open
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.write(PAGE.subarray(0, Math.floor(PAGE.length / 2)));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('abort of an incomplete gzip body', () => {
  it('ends readBody soon after the abort (real HTTP, real gunzip)', async () => {
    const controller = new AbortController();
    const transport = abortableTransport(controller.signal);
    const res = await transport.request(new URL(`http://127.0.0.1:${port}/`), { address: '127.0.0.1', family: 4 },
      { method: 'GET', headers: { 'accept-encoding': 'gzip' }, timeoutMs: 10_000 });
    setTimeout(() => controller.abort(), 100);
    const t0 = Date.now();
    await expect(readBody(res, 10_000_000, { bytesLeft: 10_000_000, deadline: Date.now() + 10_000 })).rejects.toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a check on such a host frees its slot at the deadline', async () => {
    // the real transport, but every name resolves to a public address and the
    // connection goes to the loopback server: only the address check is bypassed
    const transportFor = (signal: AbortSignal): Transport => {
      const real = abortableTransport(signal);
      return {
        resolve: async () => [{ address: '93.184.216.34', family: 4 }],
        request: (url, _address, init) =>
          real.request(new URL(`http://127.0.0.1:${port}${url.pathname}`), { address: '127.0.0.1', family: 4 }, init),
      };
    };
    const s = createCheckService({ deadlineMs: 400, perHour: 10, transportFor, runner: runCheck, log: () => {} });
    const t0 = Date.now();
    const r = await s.handle({ domain: 'gzip-stall.example', lang: 'de', clientAddress: '198.51.100.1' });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.status).toBe(504);
    expect(s.state().slotsInUse).toBe(0);
  });
});

