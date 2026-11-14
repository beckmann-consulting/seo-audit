// ultimate-41, point 4: the real runner for lib/lighthouse/local.ts. One fresh Chromium per run (chrome-launcher,
// with its own temporary profile under TMPDIR, deleted by kill()), all its traffic through the guard proxy.
// Lighthouse is loaded only here and only when a run starts (next.config.js keeps it out of the bundle).
import * as chromeLauncher from 'chrome-launcher';
import { startGuardProxy, type GuardProxy, type GuardProxyOptions } from './guard-proxy';
import type { LhrLike, LighthouseRunner, Strategy } from './local';

/** The switches of the local render (lib/ai-visibility/local-render.ts CHROMIUM_ARGS) with our proxy, plus no QUIC. */
export function chromiumFlags(proxyPort: number): string[] {
  return [
    '--headless=new',
    `--proxy-server=http://127.0.0.1:${proxyPort}`,
    '--proxy-bypass-list=<-loopback>', // loopback goes through the proxy too
    '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1', // Chromium resolves nothing itself
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp', // no UDP past the proxy
    '--disable-quic', // no HTTP/3 over UDP
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-pings',
    '--dns-prefetch-disable',
    '--no-first-run',
    '--disable-default-apps',
    '--disable-extensions',
  ];
}

// The switch --force-webrtc-ip-handling-policy alone did not keep WebRTC off UDP: in the smoke test (smoke.test.ts)
// STUN packets still reached a loopback port. The same policy as profile preferences (the ones the extension API
// privacy.network sets), written by chrome-launcher into the run's own temporary profile:
export const WEBRTC_PREFS = {
  webrtc: { ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, nonproxied_udp_enabled: false },
};

export interface ChromeRunnerOptions {
  chromePath: string;
  proxy?: Omit<GuardProxyOptions, 'extraPorts'>; // tests only: resolver and connector
  extraPorts?: number[];
}

export async function createChromeRunner(o: ChromeRunnerOptions): Promise<LighthouseRunner & { proxy: GuardProxy }> {
  const proxy = await startGuardProxy({ ...o.proxy, extraPorts: o.extraPorts });
  let closed = false;
  return {
    proxy,
    async run(url: string, strategy: Strategy, timeoutMs: number): Promise<LhrLike> {
      if (closed) throw new Error('runner closed');
      const chrome = await chromeLauncher.launch({ chromePath: o.chromePath, chromeFlags: chromiumFlags(proxy.port), prefs: WEBRTC_PREFS, logLevel: 'silent' });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const { default: lighthouse } = await import('lighthouse');
        const config = strategy === 'desktop' ? (await import('lighthouse/core/config/desktop-config.js')).default : undefined;
        const flags = { port: chrome.port, output: 'json' as const, logLevel: 'error' as const, onlyCategories: ['performance'], maxWaitForLoad: Math.max(5_000, timeoutMs - 10_000) };
        const expiry = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`run over its ${timeoutMs} ms`)), timeoutMs); });
        const run = lighthouse(url, flags, config);
        // after a timeout the run fails once kill() below ends Chromium; that late rejection must not go unhandled
        run.catch(() => undefined);
        const result = await Promise.race([run, expiry]);
        if (!result?.lhr) throw new Error('Lighthouse gave no result');
        if (result.lhr.runtimeError) throw new Error(`Lighthouse: ${result.lhr.runtimeError.code}`);
        return result.lhr as unknown as LhrLike;
      } finally {
        clearTimeout(timer);
        // kill() ends Chromium and removes the temporary profile chrome-launcher made
        await chrome.kill();
      }
    },
    async close() {
      closed = true;
      await proxy.close();
    },
  };
}
