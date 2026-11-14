// ultimate-55: how the local render of check 5 starts its Chromium. The switch against WebRTC alone let STUN packets
// through (local-render.smoke.test.ts); each page's Chromium gets a fresh profile holding the WebRTC preferences too.
import { describe, it, expect } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CHROMIUM_ARGS, launchOptions } from './local-render';
import { WEBRTC_PREFS, WEBRTC_SWITCH, profileWithWebrtcLock } from '@/lib/util/webrtc-lock';
import { WEBRTC_PREFS as LIGHTHOUSE_PREFS, chromiumFlags } from '@/lib/lighthouse/runner';

describe('local render: start options', () => {
  it('no network of its own: dead proxy, no resolver, no QUIC, the WebRTC switch', () => {
    expect(CHROMIUM_ARGS).toEqual(expect.arrayContaining([
      '--host-resolver-rules=MAP * ~NOTFOUND', '--proxy-server=127.0.0.1:9', '--proxy-bypass-list=<-loopback>',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', '--disable-quic',
    ]));
    expect(WEBRTC_SWITCH).toBe('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
  });

  it('headless, no service workers, the switches above, the audit user agent', () => {
    expect(launchOptions({ executablePath: '/usr/bin/chromium' })).toEqual({ executablePath: '/usr/bin/chromium', headless: true, args: CHROMIUM_ARGS, serviceWorkers: 'block' });
    expect(launchOptions({ executablePath: '/c', auditHeaders: { 'User-Agent': 'AuditBot/1' } }).userAgent).toBe('AuditBot/1');
  });

  it('the profile holds the WebRTC preferences: no UDP outside the proxy, no route of its own', async () => {
    const dir = await profileWithWebrtcLock('aiv-render-test-');
    try {
      expect(path.dirname(dir)).toBe(os.tmpdir());
      const prefs = JSON.parse(await readFile(path.join(dir, 'Default', 'Preferences'), 'utf8'));
      expect(prefs).toEqual(WEBRTC_PREFS);
      expect(prefs.webrtc).toEqual({ ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, nonproxied_udp_enabled: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('local Lighthouse uses the same preferences and switch', () => {
    expect(LIGHTHOUSE_PREFS).toBe(WEBRTC_PREFS);
    expect(chromiumFlags(4000)).toContain(WEBRTC_SWITCH);
  });
});
