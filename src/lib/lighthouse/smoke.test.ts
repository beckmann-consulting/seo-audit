// ultimate-41, point 4: Lighthouse with a real Chromium behind the guard proxy. Runs only with LIGHTHOUSE_SMOKE=1
// (and LIGHTHOUSE_CHROMIUM or AI_LOCAL_CHROMIUM); the variable only selects this test and changes nothing in the
// service. The test's connector leads one public test address to a local test server; the page served there tries
// to reach loopback by fetch and by WebRTC (STUN over UDP). Expected: a score, and nothing arrives at loopback.
import { describe, it, expect } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import * as dgram from 'node:dgram';
import type { Address } from '@/lib/ai-visibility/safe-fetch';
import { createChromeRunner } from './runner';
import { metricsOf } from './local';

const CHROMIUM = process.env.LIGHTHOUSE_CHROMIUM || process.env.AI_LOCAL_CHROMIUM || '';
const PUBLIC: Address = { address: '93.184.215.14', family: 4 };

describe.skipIf(process.env.LIGHTHOUSE_SMOKE !== '1' || !CHROMIUM)('Lighthouse smoke with a real Chromium (ultimate-41)', () => {
  it('measures a page, and the page cannot reach loopback by fetch or WebRTC', async () => {
    let trapHits = 0;
    let udpHits = 0;
    const trap = http.createServer((_req, res) => { trapHits++; res.end('reached'); });
    await new Promise<void>(r => trap.listen(0, '127.0.0.1', () => r()));
    const trapPort = (trap.address() as net.AddressInfo).port;
    const udp = dgram.createSocket('udp4');
    udp.on('message', () => { udpHits++; });
    await new Promise<void>(r => udp.bind(0, '127.0.0.1', () => r()));
    const udpPort = udp.address().port;
    const page = `<!doctype html><html lang="en"><head><title>Smoke</title><meta name="viewport" content="width=device-width">
<script src="/app.js" defer></script></head><body><h1>Smoke test page</h1><p>Some text for the largest paint.</p>
<script>
fetch('http://127.0.0.1:${trapPort}/from-fetch').catch(() => {});
try {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:${udpPort}' }] });
  pc.createDataChannel('x');
  pc.createOffer().then(o => pc.setLocalDescription(o)).catch(() => {});
} catch (e) {}
</script></body></html>`;
    const site = http.createServer((req, res) => {
      if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end('document.title += "!";'); return; }
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(page);
    });
    await new Promise<void>(r => site.listen(0, '127.0.0.1', () => r()));
    const sitePort = (site.address() as net.AddressInfo).port;

    const runner = await createChromeRunner({
      chromePath: CHROMIUM,
      proxy: {
        resolve: host => host === 'smoke.example' ? Promise.resolve([PUBLIC]) : net.isIP(host) ? Promise.resolve([{ address: host, family: net.isIP(host) as 4 | 6 }]) : Promise.reject(new Error('ENOTFOUND')),
        connect: (address, port) => {
          if (address.address !== PUBLIC.address || port !== 80) throw new Error(`unexpected connect ${address.address}:${port}`);
          return net.connect({ host: '127.0.0.1', port: sitePort });
        },
      },
    });
    try {
      const lhr = await runner.run('http://smoke.example/', 'mobile', 60_000);
      const m = metricsOf(lhr);
      expect(m.score).toBeGreaterThan(0);
      expect(m.fcp).toBeGreaterThan(0);
      await new Promise(r => setTimeout(r, 1000)); // anything late would still arrive now
      expect(trapHits).toBe(0);
      expect(udpHits).toBe(0);
      expect(runner.proxy.refusals.some(r => r.startsWith(`127.0.0.1:${trapPort}: `))).toBe(true);
      // the console of the test run shows what the proxy refused
      console.log(`smoke: score ${m.score}, FCP ${Math.round(m.fcp ?? 0)} ms, refusals: ${runner.proxy.refusals.join(' | ')}`);
    } finally {
      await runner.close();
      await new Promise<void>(r => site.close(() => r()));
      await new Promise<void>(r => trap.close(() => r()));
      udp.close();
    }
  }, 120_000);
});
