import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkSSL } from './external-checks';

// SSL Labs polling tests. The function uses real setTimeout for the
// 10s inter-poll wait — we install fake timers so each test runs in
// milliseconds instead of minutes. fetch is stubbed per test to drive
// the desired status sequence.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Helper that drives a sequence of fetch responses. Index 0 = trigger
// call response, indexes 1..N = poll responses, then any extras are
// reused for the fallback HTTPS probe.
function stubFetchSequence(responses: Response[]): ReturnType<typeof vi.fn> {
  let i = 0;
  const spy = vi.fn(async () => {
    const r = responses[i] ?? responses[responses.length - 1];
    i++;
    return r;
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('checkSSL — happy path', () => {
  it('returns grade and cert info when poll resolves to READY', async () => {
    stubFetchSequence([
      jsonResponse({ status: 'IN_PROGRESS' }), // trigger
      jsonResponse({ status: 'IN_PROGRESS' }), // poll 1
      jsonResponse({
        status: 'READY',
        endpoints: [{
          grade: 'A',
          details: {
            cert: { notAfter: Date.now() + 60 * 86400000, issuerSubject: 'Lets Encrypt' },
            protocols: [{ name: 'TLS', version: '1.3' }],
          },
        }],
      }),
    ]);
    const promise = checkSSL('example.com');
    await vi.advanceTimersByTimeAsync(20_000); // 2 polls × 10s
    const result = await promise;
    expect(result.valid).toBe(true);
    expect(result.grade).toBe('A');
    expect(result.issuer).toBe('Lets Encrypt');
    expect(result.daysUntilExpiry).toBeGreaterThan(50);
    expect(result.pendingSlow).toBeUndefined();
  });

  it('picks the worst grade across multiple endpoints', async () => {
    stubFetchSequence([
      jsonResponse({ status: 'IN_PROGRESS' }),
      jsonResponse({
        status: 'READY',
        endpoints: [
          { grade: 'A+', details: {} },
          { grade: 'B', details: {} }, // worst valid grade in the set
          { grade: 'A', details: {} },
        ],
      }),
    ]);
    const promise = checkSSL('example.com');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.grade).toBe('B');
    expect(result.valid).toBe(true);
  });

  it('marks T (untrusted cert) as invalid', async () => {
    stubFetchSequence([
      jsonResponse({ status: 'IN_PROGRESS' }),
      jsonResponse({ status: 'READY', endpoints: [{ grade: 'T' }] }),
    ]);
    const promise = checkSSL('expired.example');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.grade).toBe('T');
    expect(result.valid).toBe(false);
  });
});

describe('checkSSL — ERROR status', () => {
  it('returns the SSL Labs error message when status=ERROR', async () => {
    stubFetchSequence([
      jsonResponse({ status: 'IN_PROGRESS' }),
      jsonResponse({ status: 'ERROR', statusMessage: 'Unable to resolve domain name' }),
      // Fallback HTTPS probe
      new Response('', { status: 200 }),
    ]);
    const promise = checkSSL('nonexistent.example');
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await promise;
    expect(result.error).toBe('Unable to resolve domain name');
    expect(result.pendingSlow).toBeUndefined();
  });
});

describe('checkSSL — 180s timeout', () => {
  it('falls back to HTTPS probe and sets pendingSlow when polling never readies', async () => {
    // Fill the queue with IN_PROGRESS so every poll keeps the loop spinning.
    const responses: Response[] = [jsonResponse({ status: 'IN_PROGRESS' })];
    for (let i = 0; i < 20; i++) {
      responses.push(jsonResponse({ status: 'IN_PROGRESS' }));
    }
    // Fallback HTTPS probe response
    responses.push(new Response('', { status: 200 }));
    stubFetchSequence(responses);

    const promise = checkSSL('slow.example');
    // Run 18 polls × 10s = 180s, then the loop exits.
    await vi.advanceTimersByTimeAsync(190_000);
    const result = await promise;
    expect(result.pendingSlow).toBe(true);
    expect(result.valid).toBe(true); // fallback probe succeeded
    expect(result.grade).toBeUndefined();
  });
});

describe('checkSSL — DNS status loop', () => {
  it('keeps polling through DNS status until READY', async () => {
    stubFetchSequence([
      jsonResponse({ status: 'IN_PROGRESS' }), // trigger
      jsonResponse({ status: 'DNS' }),
      jsonResponse({ status: 'DNS' }),
      jsonResponse({ status: 'IN_PROGRESS' }),
      jsonResponse({ status: 'READY', endpoints: [{ grade: 'A+' }] }),
    ]);
    const promise = checkSSL('example.com');
    await vi.advanceTimersByTimeAsync(40_000);
    const result = await promise;
    expect(result.grade).toBe('A+');
    expect(result.valid).toBe(true);
  });
});
