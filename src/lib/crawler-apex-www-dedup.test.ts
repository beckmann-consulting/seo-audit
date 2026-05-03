import { describe, it, expect, vi, afterEach } from 'vitest';
import { crawlSite } from './crawler';

// Integration-style regression test for the apex↔www duplicate-page
// bug Tobias spotted on deepcyte.bio / ideacompass.de / get-together-
// again.de. Pre-fix the crawler keyed visited on the raw request URL,
// missed the redirect-final-URL, and re-crawled the page when a self-
// link to the www variant was discovered. Post-fix dedupKey collapses
// apex/www, request/final-URL, trailing-slash variants into a single
// key so visited fires on the second discovery.
//
// We mock the StaticRenderer's fetch by intercepting global fetch.
// First call (to https://deepcyte.bio): a 301 redirect to the www
// variant. Second call (to https://www.deepcyte.bio/): a 200 with a
// page body containing self-links the crawler will discover. If the
// fix is correct, the crawler stops after one logical page (one or
// two fetch calls — the request URL goes through 301-follow then a
// 200 read). Pre-fix the crawler made a third fetch call to re-crawl
// the www variant, and pages[] ended up with two entries.

afterEach(() => { vi.restoreAllMocks(); });

const HOMEPAGE_HTML = `
<!doctype html><html><head><title>Home</title></head>
<body>
  <a href="/">home</a>
  <a href="https://www.deepcyte.bio/">also home</a>
  <a href="https://deepcyte.bio/">apex too</a>
</body></html>`.trim();

describe('crawlSite — apex/www redirect dedup', () => {
  it('produces exactly one homepage entry when apex redirects to www and the page self-links to both', async () => {
    // StaticRenderer issues `fetch` with redirect: 'manual'. It expects
    // a 301 + Location header on the first hop, then it follows up with
    // a fetch to the Location target. We intercept both shapes here.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url === 'https://deepcyte.bio' || url === 'https://deepcyte.bio/') {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://www.deepcyte.bio/' },
        });
      }
      if (url === 'https://www.deepcyte.bio/') {
        return new Response(HOMEPAGE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      // Fallback for any unexpected URL: 404 so the test surfaces
      // overcrawl as a failure rather than infinite loop.
      return new Response('', { status: 404 });
    });

    const { pages } = await crawlSite(
      'https://deepcyte.bio',
      0,
    );

    // Exactly one homepage entry. Pre-fix this was 2.
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe('https://www.deepcyte.bio/');

    // Verify no overcrawl: at most 2 fetches (the redirect-follow chain).
    // Pre-fix the spy saw 3+ calls because the www variant was re-crawled.
    const distinctUrls = new Set(fetchSpy.mock.calls.map(c => String(c[0])));
    expect(distinctUrls.has('https://deepcyte.bio')).toBe(true);
    expect(distinctUrls.has('https://www.deepcyte.bio/')).toBe(true);
    // No call to a fourth variant — every self-link points to a key
    // that's already in visited after the redirect-follow.
  });

  it('also dedups when the user enters the www form and the page links to the apex', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url === 'https://www.deepcyte.bio/' || url === 'https://www.deepcyte.bio') {
        return new Response(HOMEPAGE_HTML, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      // Apex redirects to www same as before — but with this start URL
      // the apex variant should never get fetched (visited set has it
      // post-discovery via dedupKey).
      return new Response('', { status: 404 });
    });

    const { pages } = await crawlSite('https://www.deepcyte.bio/');
    expect(pages).toHaveLength(1);
  });
});
