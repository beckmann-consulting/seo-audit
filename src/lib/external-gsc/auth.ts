// Google Search Console OAuth: refresh-token → access-token exchange.
//
// Per the Phase G plan, Option A: a single refresh token in
// .env.production drives all GSC calls. Multi-user OAuth flows wait
// for H2. The discriminated union below is the public seam: the
// future service-account-json branch (G5) will land without
// touching call sites.
//
// Caching: access tokens last 60 minutes. We cache by refresh-token
// (the user-private key) and refresh 60s before expiry to avoid
// edge-case 401s from clock drift.

export type GscAuth =
  | { type: 'env-refresh-token'; refreshToken: string }
  | { type: 'service-account-json'; json: Record<string, unknown> };

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const tokenCache = new Map<string, CachedToken>();

const REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry

// Test seam: the OAuth-token endpoint can be overridden so unit tests
// never hit Google directly. Runtime callers use the default.
export interface AuthOptions {
  tokenEndpoint?: string;
}

const DEFAULT_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export class GscAuthError extends Error {
  constructor(message: string, public readonly userError = false) {
    super(message);
    this.name = 'GscAuthError';
  }
}

export async function getAccessToken(auth: GscAuth, opts: AuthOptions = {}): Promise<string> {
  if (auth.type === 'service-account-json') {
    // Reserved for G5 (Service-Account flow for client-controlled
    // audits). Kept as an unreachable branch so today's call sites
    // don't have to special-case the union.
    throw new GscAuthError(
      'Service-account-json auth is not implemented yet (planned for G5).',
    );
  }

  const cacheKey = auth.refreshToken;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return cached.accessToken;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new GscAuthError(
      'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET missing — see DEPLOYMENT.md §2a.',
    );
  }

  const resp = await fetch(opts.tokenEndpoint ?? DEFAULT_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: auth.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new GscAuthError(
      `OAuth token refresh failed (${resp.status}): ${body.slice(0, 200)}`,
    );
  }

  const data = await resp.json();
  if (!data.access_token || typeof data.expires_in !== 'number') {
    throw new GscAuthError('OAuth response missing access_token / expires_in');
  }

  const expiresAt = Date.now() + data.expires_in * 1000;
  tokenCache.set(cacheKey, { accessToken: data.access_token, expiresAt });
  return data.access_token;
}

// Test helper — clears the in-process cache between cases.
export function _resetTokenCacheForTests(): void {
  tokenCache.clear();
}
