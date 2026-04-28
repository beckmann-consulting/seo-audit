#!/usr/bin/env node
// One-shot Google OAuth bootstrap for GSC (G1) or GA4 (G2).
//
// We use Option A from the Phase G plan: a single Google account,
// refresh-token in .env.production. This script is what generates
// that refresh token; the audit service uses it at runtime to mint
// access tokens without ever opening a browser.
//
// What it does:
//   1. Reads GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET from
//      the environment (or .env.local / .env if present).
//   2. Spawns a loopback HTTP server on 127.0.0.1:8765.
//   3. Prints the Google consent URL — you open it in any browser,
//      log in with the Google account that owns the GSC/GA4 property,
//      and approve the read-only scopes.
//   4. Google redirects to the loopback URL with ?code=…
//   5. Script exchanges the code for tokens, prints the refresh_token
//      to stdout, exits.
//   6. You paste the printed line into .env.production once.
//
// Run again whenever you revoke access at
// https://myaccount.google.com/permissions or change scopes.
//
// Usage:
//   node scripts/oauth-bootstrap.mjs gsc
//   node scripts/oauth-bootstrap.mjs ga4
//
// Or via npm:
//   npm run oauth:gsc
//   npm run oauth:ga4

import http from 'node:http';
import { URL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

// Read-only scopes — that's all the audit needs.
// Webmasters API is the legacy name for what's marketed as Search Console.
const SCOPES = {
  gsc: ['https://www.googleapis.com/auth/webmasters.readonly'],
  ga4: ['https://www.googleapis.com/auth/analytics.readonly'],
};

const ENV_VAR_NAMES = {
  gsc: 'GSC_REFRESH_TOKEN',
  ga4: 'GA4_REFRESH_TOKEN',
};

// Loopback redirect — must be registered in the Google Cloud OAuth
// client config under "Authorized redirect URIs" exactly as printed.
const LOOPBACK_PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/oauth/callback`;

// Crude .env loader — only handles plain KEY=value lines, no quotes
// or escapes. Sufficient for the few Client-ID / Client-Secret values
// we read here. Production env loading happens elsewhere.
function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

async function main() {
  loadEnv();

  const service = process.argv[2];
  if (!service || !(service in SCOPES)) {
    console.error('Usage: node scripts/oauth-bootstrap.mjs <gsc|ga4>');
    process.exit(1);
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error('Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.');
    console.error('Add both to .env.local (dev) or .env.production (prod) and re-run.');
    console.error('See DEPLOYMENT.md §2b for how to create them in Google Cloud Console.');
    process.exit(1);
  }

  // Build the consent URL. access_type=offline + prompt=consent forces
  // Google to issue a refresh_token even on subsequent re-auths;
  // without prompt=consent you only get one on the very first auth.
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('scope', SCOPES[service].join(' '));

  console.log(`\n— OAuth bootstrap: ${service.toUpperCase()} —\n`);
  console.log('1. Open this URL in your browser:\n');
  console.log(authUrl.toString());
  console.log(`\n2. Sign in with the Google account that has access to the ${service.toUpperCase()} property.`);
  console.log('3. Approve the read-only scopes.');
  console.log(`4. The browser will redirect to localhost:${LOOPBACK_PORT}; this script will catch it.\n`);

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${LOOPBACK_PORT}`);
      if (u.pathname !== '/oauth/callback') {
        res.writeHead(404).end();
        return;
      }
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      if (err) {
        res.end(`<h1>OAuth error</h1><p>${err}</p>`);
        server.close();
        reject(new Error(`OAuth error: ${err}`));
        return;
      }
      if (!c) {
        res.end('<h1>No code received</h1>');
        server.close();
        reject(new Error('Callback hit but no ?code= present'));
        return;
      }
      res.end('<h1>Got it. You can close this tab.</h1>');
      server.close();
      resolve(c);
    });
    server.listen(LOOPBACK_PORT, '127.0.0.1');
    server.on('error', reject);
  });

  console.log('\nGot authorization code. Exchanging for tokens…');

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenResp.ok) {
    console.error(`Token exchange failed: HTTP ${tokenResp.status}`);
    console.error(await tokenResp.text());
    process.exit(1);
  }
  const tokens = await tokenResp.json();
  if (!tokens.refresh_token) {
    // This typically happens when the user already granted access in
    // the past — Google only emits a refresh_token on first consent
    // unless prompt=consent forces re-issuance (which we set above).
    console.error('No refresh_token in the response.');
    console.error('Likely cause: this account already granted access at some point.');
    console.error('Revoke at https://myaccount.google.com/permissions and re-run this script.');
    process.exit(1);
  }

  const envVar = ENV_VAR_NAMES[service];
  console.log('\n✓ Success. Add this single line to .env.production:\n');
  console.log(`${envVar}=${tokens.refresh_token}`);
  console.log('\nKeep it secret. The token does not expire unless revoked.');
  console.log('After saving, restart the seo-audit service so it picks up the new env.\n');
}

main().catch(err => {
  console.error('\nBootstrap failed:', err.message);
  process.exit(1);
});
