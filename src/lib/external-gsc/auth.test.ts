import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { getAccessToken, GscAuthError, _resetTokenCacheForTests } from './auth';

const ENV_BACKUP = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID,
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
};

beforeEach(() => {
  _resetTokenCacheForTests();
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-secret';
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.GOOGLE_OAUTH_CLIENT_ID = ENV_BACKUP.GOOGLE_OAUTH_CLIENT_ID;
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = ENV_BACKUP.GOOGLE_OAUTH_CLIENT_SECRET;
});

const makeTokenResponse = (accessToken: string, expiresIn: number) =>
  () => Promise.resolve(new Response(
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn, token_type: 'Bearer' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  ));

describe('getAccessToken — env-refresh-token branch', () => {
  it('exchanges the refresh token for an access token via fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(makeTokenResponse('access-1', 3600));

    const token = await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    expect(token).toBe('access-1');
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(String(init.body)).toContain('refresh_token=r1');
    expect(String(init.body)).toContain('grant_type=refresh_token');
    expect(String(init.body)).toContain('client_id=test-client-id');
  });

  it('caches the access token across calls with the same refresh token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(makeTokenResponse('access-cached', 3600));

    await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('refreshes when the cached token is within the 60s expiry buffer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // First call returns a near-expired token
      .mockImplementationOnce(makeTokenResponse('first', 30)) // expires in 30s, buffer is 60s
      .mockImplementationOnce(makeTokenResponse('second', 3600));

    const t1 = await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    const t2 = await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    expect(t1).toBe('first');
    expect(t2).toBe('second'); // cache rejected because of buffer
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('caches per refresh token, not globally', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(makeTokenResponse('for-r1', 3600))
      .mockImplementationOnce(makeTokenResponse('for-r2', 3600));

    const t1 = await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' });
    const t2 = await getAccessToken({ type: 'env-refresh-token', refreshToken: 'r2' });
    expect(t1).toBe('for-r1');
    expect(t2).toBe('for-r2');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws GscAuthError when CLIENT_ID is missing from env', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    await expect(getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' }))
      .rejects.toThrow(GscAuthError);
  });

  it('throws GscAuthError when the OAuth endpoint returns 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('invalid_grant', { status: 400 }),
    );
    await expect(getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' }))
      .rejects.toThrow(/OAuth token refresh failed.*400/);
  });

  it('throws when the response is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    await expect(getAccessToken({ type: 'env-refresh-token', refreshToken: 'r1' }))
      .rejects.toThrow(/missing access_token/);
  });
});

describe('getAccessToken — service-account-json branch', () => {
  it('throws a clear "not implemented" error so call sites know G5 is needed', async () => {
    await expect(getAccessToken({ type: 'service-account-json', json: {} }))
      .rejects.toThrow(/G5/);
  });
});
