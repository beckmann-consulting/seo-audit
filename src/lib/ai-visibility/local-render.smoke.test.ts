// ultimate-55: the local render of check 5 with a real Chromium against a page that tries WebRTC. Runs only with
// LOCAL_RENDER_SMOKE=1 and AI_LOCAL_CHROMIUM (the variable only selects this test and changes nothing in the service).
// The page is served from a table by a test transport (nothing leaves the machine); its script opens an
// RTCPeerConnection with a STUN server on a loopback UDP port and a TURN server over TCP on a loopback port.
// Expected: not one UDP packet and not one TCP connection arrive at loopback.
// LOCAL_RENDER_SMOKE_OUT names a file the numbers are appended to (vitest shows no console of a passed test).
import { describe, it, expect } from 'vitest';
import * as dgram from 'node:dgram';
import * as net from 'node:net';
import { Readable } from 'node:stream';
import { appendFileSync } from 'node:fs';
import { localRender } from './local-render';
import { DEFAULT_LIMITS, type Transport } from './safe-fetch';

const CHROMIUM = process.env.AI_LOCAL_CHROMIUM || '';

describe.skipIf(process.env.LOCAL_RENDER_SMOKE !== '1' || !CHROMIUM)('local render smoke: WebRTC reaches no loopback port (ultimate-55)', () => {
  it('sends no UDP packet and opens no TCP connection to loopback', async () => {
    let udpPackets = 0;
    let tcpConnections = 0;
    const udp = dgram.createSocket('udp4');
    udp.on('message', () => { udpPackets++; });
    await new Promise<void>(r => udp.bind(0, '127.0.0.1', () => r()));
    const udpPort = udp.address().port;
    const trap = net.createServer(s => { tcpConnections++; s.destroy(); });
    await new Promise<void>(r => trap.listen(0, '127.0.0.1', () => r()));
    const tcpPort = (trap.address() as net.AddressInfo).port;

    const page = `<!doctype html><html lang="en"><head><title>WebRTC smoke</title></head><body><main><h1>WebRTC smoke</h1></main>
<script>
const b = document.body;
try {
  const pc = new RTCPeerConnection({ iceServers: [
    { urls: 'stun:127.0.0.1:${udpPort}' },
    { urls: 'turn:127.0.0.1:${tcpPort}?transport=tcp', username: 'u', credential: 'p' },
  ] });
  b.setAttribute('data-rtc', 'created');
  let n = 0;
  pc.onicecandidate = e => { if (e.candidate) b.setAttribute('data-candidates', String(++n)); };
  pc.createDataChannel('x');
  pc.createOffer().then(o => pc.setLocalDescription(o)).catch(err => b.setAttribute('data-rtc-error', String(err)));
} catch (err) {
  b.setAttribute('data-rtc', 'unavailable: ' + err);
}
</script></body></html>`;
    const t: Transport = {
      async resolve(host) {
        if (host === 'site.test') return [{ address: '93.184.215.14', family: 4 }];
        throw new Error('ENOTFOUND');
      },
      async request() {
        return { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Readable.from([Buffer.from(page)]) };
      },
    };
    try {
      const out = await localRender({ executablePath: CHROMIUM, auditUrl: 'https://site.test/', urls: ['https://site.test/'], transport: t,
        limits: { ...DEFAULT_LIMITS, pageTimeMs: 8000 }, quietMs: 1500 });
      await new Promise(r => setTimeout(r, 1000)); // anything late would still arrive now
      const o = out.get('https://site.test/');
      const body = /<body([^>]*)>/.exec(o?.renderedHtml ?? '')?.[1]?.trim() ?? '';
      const line = `local render smoke: ${JSON.stringify({ udpPackets, tcpConnections, body, incompleteReason: o?.incompleteReason ?? null })}`;
      console.log(line);
      if (process.env.LOCAL_RENDER_SMOKE_OUT) appendFileSync(process.env.LOCAL_RENDER_SMOKE_OUT, `${new Date().toISOString()} ${line}\n`);
      expect(o?.renderedHtml).toContain('WebRTC smoke');
      expect(udpPackets).toBe(0);
      expect(tcpConnections).toBe(0);
    } finally {
      udp.close();
      await new Promise<void>(r => trap.close(() => r()));
    }
  }, 60_000);
});
