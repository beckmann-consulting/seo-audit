// URL normalisation for cross-API matching.
//
// External-data integrations (GSC, Bing, future GA4) return URL keys
// that may differ in case-trivial ways from the URLs the crawler
// collected — most often a trailing slash on the external side that
// our crawl doesn't have, or vice versa. Without a normalisation step
// the coverage / impressions joins would systematically miss those
// pairs and report false positives.
//
// Rules:
//   - parsed via URL constructor (anything malformed bypasses
//     normalisation and returns verbatim — better to surface "weird
//     URL" than crash the audit)
//   - hash dropped (#section anchors aren't separate pages)
//   - trailing slash on the path stripped, but NOT on a bare-host
//     path "/" (that would erase the path entirely and mangle the URL)
//
// Note: protocol + host case-folding intentionally NOT done here.
// URL constructor already lower-cases the host, but path/query stay
// case-sensitive — which is correct (some sites care about path
// case, e.g. /Page vs /page).

export function normaliseUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.href;
  } catch {
    return u;
  }
}
