// Post-failure classifier — when the renderer threw, do a quick HEAD
// probe against the origin so we can tell apart three outcomes that
// otherwise all look like "the renderer didn't get HTML":
//
//   2xx/3xx HEAD → renderFailed   (URL is reachable; JS render only)
//   4xx/5xx HEAD → httpErrors     (URL really is broken at the origin)
//   HEAD itself fails → unreachable (network / DNS / timeout)
//
// Without this step every renderer-throw case ended up in renderFailed
// uniformly, masking real HTTP errors when the JS renderer happened
// to throw before the lab noticed the bad status. The HEAD probe is
// 5s max so a single bad URL adds at most that to the audit.

export type CrawlClassification =
  | { bucket: 'httpErrors';  status: number }
  | { bucket: 'unreachable'; reason: string }
  | { bucket: 'renderFailed'; reason: string };

export async function classifyAfterRendererThrow(
  url: string,
  originalReason: string,
  headers: HeadersInit,
  // Allow the test to inject a fake fetch. Defaults to global fetch
  // in production. Keeps the function deterministically testable
  // without monkey-patching globalThis from each test.
  fetchImpl: typeof fetch = fetch,
): Promise<CrawlClassification> {
  try {
    const resp = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (resp.status >= 400) {
      return { bucket: 'httpErrors', status: resp.status };
    }
    // 2xx or 3xx (3xx is unusual since redirect: 'follow' is set, but
    // some servers respond with non-redirecting 3xx — treat as reachable).
    return { bucket: 'renderFailed', reason: originalReason };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { bucket: 'unreachable', reason };
  }
}
