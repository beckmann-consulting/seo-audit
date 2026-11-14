// ultimate-55: WebRTC kept off UDP in every Chromium this tool starts with page JavaScript in it: the local render of
// check 5 (lib/ai-visibility/local-render.ts) and local Lighthouse (lib/lighthouse/runner.ts). The switch
// --force-webrtc-ip-handling-policy alone let STUN packets through to a loopback UDP port in both smoke tests
// (lib/lighthouse/smoke.test.ts in ultimate-41: 5 packets; lib/ai-visibility/local-render.smoke.test.ts: 3 packets).
// The same policy as profile preferences (the ones the extension API privacy.network sets) stopped them.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The switch; kept next to the preferences, it is not enough on its own. */
export const WEBRTC_SWITCH = '--force-webrtc-ip-handling-policy=disable_non_proxied_udp';

/** WebRTC only through the proxy, which is a dead or guarded one in both uses: no UDP, no route of its own. */
export const WEBRTC_PREFS = {
  webrtc: { ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, nonproxied_udp_enabled: false },
};

/**
 * A fresh profile directory under the temporary directory whose Default/Preferences hold WEBRTC_PREFS, for a Chromium
 * started with it as its user data directory. The caller removes it after the browser is closed.
 */
export async function profileWithWebrtcLock(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  await mkdir(path.join(dir, 'Default'));
  await writeFile(path.join(dir, 'Default', 'Preferences'), JSON.stringify(WEBRTC_PREFS));
  return dir;
}
