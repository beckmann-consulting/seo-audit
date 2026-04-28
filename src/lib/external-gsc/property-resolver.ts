// Resolves an audit's domain to a Search Console property.
//
// GSC has two property types and four URL-prefix variants per host.
// We try them in this order — Domain-Property first because it
// aggregates www/non-www and http/https into one set of metrics:
//
//   1. sc-domain:{baseDomain}
//   2. https://{baseDomain}/
//   3. http://{baseDomain}/
//   4. https://www.{baseDomain}/
//   5. http://www.{baseDomain}/
//
// `baseDomain` is the input domain with any leading "www." stripped,
// so an audit on www.example.com still finds sc-domain:example.com
// and the non-www URL-prefix variants. If the audit was started on
// www.example.com explicitly we still also try the www variants
// (they're already in the list above).
//
// Returns null when none of the five variants exist in the user's
// GSC site list — the route handler converts that into a friendly
// "property not found" message rather than a 500.

export type GscPropertyVariant = 'domain' | 'https' | 'http' | 'https-www' | 'http-www';

export interface ResolvedProperty {
  siteUrl: string;             // exact value GSC expects in API calls
  variant: GscPropertyVariant; // surfaced in the UI banner
}

export function resolveGscProperty(domain: string, sites: string[]): ResolvedProperty | null {
  // Strip leading www. so the variants below cover both www and non-www.
  const baseDomain = domain.toLowerCase().replace(/^www\./, '');
  const siteSet = new Set(sites);

  const candidates: ResolvedProperty[] = [
    { siteUrl: `sc-domain:${baseDomain}`, variant: 'domain' },
    { siteUrl: `https://${baseDomain}/`, variant: 'https' },
    { siteUrl: `http://${baseDomain}/`, variant: 'http' },
    { siteUrl: `https://www.${baseDomain}/`, variant: 'https-www' },
    { siteUrl: `http://www.${baseDomain}/`, variant: 'http-www' },
  ];

  for (const c of candidates) {
    if (siteSet.has(c.siteUrl)) return c;
  }
  return null;
}

// Human-friendly label for the resolved variant. Used by the UI
// banner ("Search Console-Daten verfügbar (Domain-Property)") and
// by error messages.
export function describeVariant(variant: GscPropertyVariant, lang: 'de' | 'en' = 'de'): string {
  if (lang === 'de') {
    switch (variant) {
      case 'domain':    return 'Domain-Property';
      case 'https':     return 'URL-Property: https://';
      case 'http':      return 'URL-Property: http://';
      case 'https-www': return 'URL-Property: https://www.';
      case 'http-www':  return 'URL-Property: http://www.';
    }
  }
  switch (variant) {
    case 'domain':    return 'Domain property';
    case 'https':     return 'URL property: https://';
    case 'http':      return 'URL property: http://';
    case 'https-www': return 'URL property: https://www.';
    case 'http-www':  return 'URL property: http://www.';
  }
}
