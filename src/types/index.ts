// ============================================================
//  TYPES — SEO Audit Pro
// ============================================================

export type Priority = 'critical' | 'important' | 'recommended' | 'optional';
export type Effort = 'low' | 'medium' | 'high';
export type Impact = 'low' | 'medium' | 'high';
export type Lang = 'de' | 'en';

// HTTP-layer error captured during a JS render. Sub-resources only —
// the main-page response is already represented by RenderResult.status,
// so we don't double-count it here. Complementary to PageData.failed
// Requests (which is the network-layer kind: DNS, CORS, ERR_ABORTED
// — Playwright fires `requestfailed` OR `response`, not both).
export interface HttpError {
  url: string;
  status: number;        // 400-599
  // Playwright req.resourceType(): 'document' | 'stylesheet' | 'script'
  // | 'image' | 'media' | 'font' | 'fetch' | 'xhr' | 'eventsource' |
  // 'websocket' | 'manifest' | 'texttrack' | 'other'.
  resourceType: string;
}

// Static-vs-rendered diff for a JS-rendered page. Only set in the JS
// path (rendering=js, or rendering=auto when the page was escalated).
// Threshold judgements ("is this delta significant?") live in the
// E5 finding consumers, NOT here — keeping the data layer neutral
// means thresholds can be tuned without rewriting persisted audits.
export interface StaticVsRenderedDiff {
  wordCountStatic: number;
  wordCountRendered: number;
  wordCountDelta: number;        // rendered - static (can be negative)
  wordCountDeltaRatio: number;   // delta / max(1, static)
  linkCountStatic: number;
  linkCountRendered: number;
  linkCountDelta: number;
}

// Subset of the @axe-core/playwright violation shape that we actually
// surface — keeps the audit-result payload compact and version-stable.
export interface AxeViolation {
  id: string;            // axe rule id, e.g. "color-contrast"
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  description: string;
  help: string;
  helpUrl: string;
  tags: string[];        // includes WCAG criteria like "wcag2aa", "wcag143"
  nodes: number;         // count of affected elements on this page
}

export type Module =
  | 'seo'
  | 'content'
  | 'legal'
  | 'ux'
  | 'tech'
  | 'performance'
  | 'accessibility'
  | 'offers';

export type UserAgentPreset =
  | 'default'
  | 'googlebot-mobile'
  | 'googlebot-desktop'
  | 'bingbot'
  | 'gptbot'
  | 'claudebot'
  | 'perplexitybot'
  | 'custom';

export interface AuditConfig {
  url: string;
  googleApiKey?: string;
  modules: Module[];
  maxPages: number; // 0 = unlimited
  quickMode?: boolean; // when true, PSI runs once (default: run twice and average for score stability)
  userAgent?: UserAgentPreset; // default: 'default'
  customUserAgent?: string; // only consulted when userAgent === 'custom'
  // Crawler URL filtering. Each entry is a JS regex source string,
  // tested against the full URL. Exclude wins over include; an empty
  // include list means "no narrowing" (only excludes are applied).
  // Validated at the route layer — bad patterns return a 400 before
  // the SSE stream opens.
  include?: string[];
  exclude?: string[];
  // HTTP Basic Auth credentials sent on every audit request. Stripped
  // from AuditResult.config before round-trip to the client so they
  // never end up in localStorage / PDF / cached audits.
  basicAuth?: { username: string; password: string };
  // Arbitrary HTTP headers added to every audit request. Useful for
  // cookie-based auth, Cloudflare bypass tokens, locale overrides, etc.
  // User-set headers OVERRIDE the built-in User-Agent / Authorization
  // when the same name is given (explicit beats implicit). Sensitive
  // values (Cookie, Authorization, X-API-Key, X-Auth-*) are masked
  // before round-trip to the client.
  customHeaders?: Record<string, string>;
  // HEAD-probe at most this many unique image URLs to estimate file
  // size from Content-Length. 0 disables the probe entirely; default
  // (when undefined) is 20 — enough to catch typical hero/listing
  // image weight without making the audit drag.
  imageHeadCheckLimit?: number;
  // Opt-in deep image-format probe. For every legacy raster image
  // (JPG/PNG) we HEAD-probe the hypothetical .webp + .avif sibling
  // and flag the ones where neither modern variant exists. Adds up
  // to MAX_DEEP_IMAGE_PROBES * 2 HEAD requests; fast in practice but
  // off by default to keep audits predictable.
  deepImageFormatCheck?: boolean;
  // Opt-in mobile-vs-desktop content-parity probe. Doubles fetch
  // count for the sampled pages — turn on when you suspect lazy-
  // loaded content or hidden-by-default mobile sections.
  mobileDesktopParityCheck?: boolean;
  mobileDesktopParitySampleSize?: number; // default 10
  // Render mode for the crawl.
  // 'static' — plain HTTP fetch, what every audit historically did.
  // 'js'     — every page routes through a real Chromium (Browserless
  //            container) so SPAs render the way Googlebot's renderer
  //            would. Slower; requires Browserless.
  // 'auto'   — DEFAULT for new audits. Static-first; pages whose static
  //            HTML looks like a CSR shell escalate to a JS render.
  //            Spends Browserless cycles only where they matter.
  rendering?: 'static' | 'js' | 'auto';
  // Screenshot capture in JS-mode. Adds Mobile (375×667) and Desktop
  // (1920×1080) screenshots of the homepage + top-3 pages by depth
  // to the audit result and the PDF export. Only honoured when
  // rendering === 'js' (static mode has no Chromium to drive).
  includeScreenshots?: boolean;
}

export interface PageData {
  url: string;
  html: string;
  statusCode: number;
  redirectedFrom?: string;
  loadTime?: number;
  contentType?: string;
  depth: number; // click distance from the start URL (0 = start page)
  redirectChain: string[]; // full redirect hops observed for this URL (empty if no redirect)
  finalUrl: string; // the URL the body was served from (last hop)
  httpStatus: number; // final HTTP status code after redirects
  protocol: string | null; // 'h2' if alt-svc advertises HTTP/2+, else null (unknown)
  xRobotsTag?: string; // raw X-Robots-Tag response header on the final hop, joined if multi-valued
  // JS-mode only: captured for the static-vs-rendered diff finding.
  staticHtml?: string;
  staticWordCount?: number;
  consoleErrors?: string[];
  failedRequests?: string[];
  renderMode?: 'static' | 'js';
  axeViolations?: AxeViolation[];
  // E4: persisted render-time + diff. Set when this page actually
  // went through Browserless (rendering=js, or rendering=auto with
  // escalation). undefined for static-only pages.
  renderTimeMs?: number;
  staticVsRenderedDiff?: StaticVsRenderedDiff;
  // E4.5: 4xx/5xx responses for sub-resources during the JS render.
  // Complementary to failedRequests (network-layer failures).
  httpErrors?: HttpError[];
}

export interface Finding {
  id: string;
  priority: Priority;
  module: Module;
  effort: Effort;
  impact: Impact;
  title_de: string;
  title_en: string;
  description_de: string;
  description_en: string;
  recommendation_de: string;
  recommendation_en: string;
  affectedUrl?: string;
}

export interface ModuleScore {
  module: Module;
  score: number; // 0-100
  label_de: string;
  label_en: string;
}

export interface CrawlStats {
  totalPages: number;
  crawledPages: number;
  brokenLinks: string[];
  redirectChains: { from: string; to: string }[];
  externalLinks: number;
  errorPages: { url: string; status: number }[]; // 4xx/5xx responses captured during crawl
}

export interface SSLInfo {
  valid: boolean;
  grade?: string;
  issuer?: string;
  expiresAt?: string;
  daysUntilExpiry?: number;
  protocols?: string[];
  error?: string;
  // True when the SSL Labs scan didn't finish within the polling
  // budget. The audit completes anyway (we fall back to a basic HTTPS
  // reachability probe), and the UI renders a neutral "scan taking
  // longer than expected" hint instead of treating it as an error.
  pendingSlow?: boolean;
}

export interface DNSInfo {
  hasSPF: boolean;
  hasDKIM: boolean;
  hasDMARC: boolean;
  spfRecord?: string;
  dmarcRecord?: string;
  // The selector under which the matching DKIM record was found
  // (e.g. "google", "selector1-example-com"). Set only when hasDKIM
  // is true. DKIM probing is heuristic — see external-checks.probeDkim.
  dkimSelector?: string;
  // Joined raw TXT value of the matching DKIM record. Set only when
  // hasDKIM is true. Sanitised: chunks are joined with no separator;
  // the validity check requires a "v=DKIM1" / "k=" / "p=" marker.
  dkimRecord?: string;
  mxRecords?: string[];
  error?: string;
}

export interface PageSpeedData {
  performanceScore?: number;
  accessibilityScore?: number;
  seoScore?: number;
  bestPracticesScore?: number;
  lcp?: number;
  cls?: number;
  fid?: number; // Lab: max-potential-fid (legacy metric, replaced by INP)
  inp?: number; // CrUX field data: Interaction to Next Paint (p75), replaces FID since March 2024
  fidField?: number; // CrUX field data: real-user FID (p75), kept alongside INP
  ttfb?: number;
  fcp?: number;
  si?: number;
  tbt?: number;
  structuredDataAuditWarning?: string; // Lighthouse 'structured-data' audit surfaces a warning
  // The DOM node Lighthouse identified as the largest contentful paint
  // target. snippet is the raw HTML, useful for showing the developer
  // exactly which element to optimize.
  lcpElement?: {
    selector: string;
    snippet: string;
    nodeLabel?: string;
  };
  error?: string;
}

export interface SafeBrowsingData {
  isSafe: boolean;
  threats?: string[];
  error?: string;
}

export type AIBotStatus = 'allowed' | 'blocked' | 'partial' | 'unspecified';

export interface AIBotRule {
  bot: string;
  purpose: 'training' | 'retrieval' | 'search' | 'mixed';
  vendor: string;
  status: AIBotStatus;
}

export interface AIReadinessInfo {
  bots: AIBotRule[];
  hasLlmsTxt: boolean;
  hasLlmsFullTxt: boolean;
  llmsTxtUrl?: string;
  wildcardBlocksAll: boolean;
  error?: string;
}

export interface SitemapUrlEntry {
  url: string;
  lastmod?: string; // ISO 8601 date
  changefreq?: string;
  priority?: number;
  imageCount: number;
}

export interface SitemapInfo {
  urls: SitemapUrlEntry[];
  sitemapUrl?: string;
  isIndex: boolean;
  subSitemaps: string[];
  error?: string;
}

export interface SecurityHeadersInfo {
  hsts?: string;
  hstsMaxAge?: number;
  hstsIncludeSubDomains?: boolean;
  csp?: string;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
  hasCookieSecure?: boolean;
  hasMixedContent?: boolean;
  checkedUrl?: string;
  error?: string;
}

export interface ParsedSchema {
  type: string;
  data: Record<string, unknown>;
}

export interface PageSEOData {
  url: string;
  title?: string;
  titleLength?: number;
  titlePixelWidth?: number; // approx Arial 20px advance-width sum, used for SERP truncation prediction
  metaDescription?: string;
  metaDescriptionLength?: number;
  metaDescriptionPixelWidth?: number;
  h1s: string[];
  h2s: string[];
  h3s: string[];
  canonicalUrl?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
  ogImageType?: string;
  ogLocale?: string;
  twitterCard?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  lang?: string;
  hasViewport: boolean;
  hasCharset: boolean;
  schemaTypes: string[];
  schemas: ParsedSchema[];
  schemaParseErrors: number;
  // Which structured-data formats the page actually publishes —
  // a single page can mix all three, which is its own (mild) issue.
  hasJsonLd: boolean;
  hasMicrodata: boolean;
  hasRdfa: boolean;
  // JS-rendering provenance + diagnostics (only set in rendering=js mode).
  renderMode?: 'static' | 'js';
  staticWordCount?: number;        // word count of the un-rendered HTML
  consoleErrors?: string[];        // browser console / page errors during render
  failedRequests?: string[];       // sub-resources that failed to load
  axeViolations?: AxeViolation[];  // axe-core WCAG findings (only when accessibility module is active + rendering=js)
  // E4: persisted render-time + diff for downstream finding consumers.
  // Set when this page actually went through Browserless (rendering=js
  // or rendering=auto with escalation); undefined for static-only pages.
  renderTimeMs?: number;
  staticVsRenderedDiff?: StaticVsRenderedDiff;
  // E4.5: HTTP 4xx/5xx sub-resource errors captured during JS render.
  httpErrors?: HttpError[];
  // Body-content fingerprints for duplicate / near-duplicate detection.
  // bodyTextHash is FNV-1a hex over normalised body text — equality means
  // exact-duplicate content. bodyMinhash is a fixed-length MinHash
  // signature for fast near-duplicate clustering. Both are empty strings /
  // arrays for pages too thin to fingerprint (wordCount < 50).
  bodyTextHash: string;
  bodyMinhash: number[];
  // Visible-text bytes / total HTML bytes. Low ratios (<10%) suggest
  // either heavy boilerplate (a thin page wrapped in a thick template)
  // or server-rendered output dominated by inline data — Google's
  // "content vs noise" heuristics tend to discount such pages.
  textHtmlRatio: number;
  // Flesch Reading Ease (EN) / Flesch-Amstad (DE) score, 0-100.
  // Higher = easier to read. Undefined when the page is too thin
  // (< 200 visible words) for the metric to be meaningful.
  readabilityScore?: number;
  readabilityLang?: 'de' | 'en';
  // Heuristic count of interactive elements that look smaller than the
  // mobile-friendly 48×48 px threshold (icon-only <a>/<button> with
  // explicit small dimensions). Conservative — under-counts; Phase E
  // (Playwright) will replace with bounding-rect measurement.
  smallTouchTargetCount: number;
  depth: number; // propagated from PageData
  inlinkCount?: number; // set after cross-page analysis
  redirectChain: string[]; // propagated from PageData
  finalUrl: string; // propagated from PageData
  imagesMissingAlt: number;
  totalImages: number;
  internalLinks: string[];
  externalLinks: string[];
  wordCount: number;
  hasRobots?: boolean; // only homepage
  hasSitemap?: boolean; // only homepage
  hasCanonical: boolean;
  renderBlockingScripts: number;
  modernImageFormats: number;
  lazyLoadedImages: number;
  hreflangs: { hreflang: string; href: string }[];
  viewportBlocksZoom: boolean;
  viewportHasInitialScale: boolean;
  fixedWidthElements: number;
  smallFontElements: number;
  legacyPlugins: number;
  likelyClientRendered: boolean;
  clientRenderSignal?: string; // what gave it away, for debugging
  bodyTextSample?: string; // first ~2000 chars of visible body text, used for content analysis
  genericAnchors: { text: string; href: string }[];
  emptyAnchors: number; // internal links with no usable anchor text and no aria-label
  hasNoindex: boolean; // meta robots contains "noindex"
  // Check 2 — image optimisation details (per page)
  imageDetails: {
    src: string;
    hasWidth: boolean;
    hasHeight: boolean;
    isLazy: boolean;
    hasSrcset: boolean;
    declaredWidth?: number;
  }[];
  // Check 3 — font loading
  fontPreloads: number;
  hasFontDisplaySwap: boolean;
  hasExternalFonts: boolean;
  // Check 4 — third-party scripts
  thirdPartyScripts: {
    domain: string;
    category: string;
    isRenderBlocking: boolean;
  }[];
  // Check 5 — favicon / web app manifest
  hasFavicon: boolean;
  hasAppleTouchIcon: boolean;
  hasWebManifest: boolean;
  hasThemeColor: boolean;
  // Block D1 — additional structural signals
  httpStatus: number; // propagated from PageData
  protocol: string | null; // propagated from PageData
  headingStructure: { level: number; text: string }[]; // full H1-H6 order of appearance
  hasPaginationLinks: boolean; // any <link rel="next"/"prev">
  paginationUrls: string[]; // resolved hrefs from rel="next" / rel="prev"
  hasAuthorSignal: boolean; // Schema.org author or meta[name=author] or rel="author"
  hasDateSignal: boolean; // <time> tag or meta publication/modified date
  externalLinksDetailed: { href: string; hasNofollow: boolean; hasNoopener: boolean }[];
  // X-Robots-Tag (HTTP header) — parsed alongside <meta robots>
  xRobotsTag?: string; // raw header value (joined if multiple)
  xRobotsNoindex: boolean; // generic '*' / unprefixed directive contains 'noindex', or 'googlebot: noindex'
  xRobotsBotSpecific: { bot: string; directives: string[] }[]; // bot-prefixed rules (e.g. 'googlebot: noindex')
}

// ============================================================
//  Google Search Console (Phase G1)
// ============================================================
// The route always populates AuditResult.gscResult — even when GSC
// is disabled — so the UI can render the right banner without
// having to distinguish "GSC was never tried" from "GSC tried and
// produced no data". Four states cover every code path:
//
//   disabled            — GSC_REFRESH_TOKEN not set in env. Audit
//                         ran without GSC by design.
//   property-not-found  — token set, but the audit's domain has no
//                         matching property in the user's GSC list.
//                         Surfaced as info, not error.
//   api-error           — token + property OK, but the GSC API
//                         returned 5xx / network error. Audit still
//                         completes; UI shows a warning.
//   ok                  — happy path. data carries the GscData payload.
//
// All four states result in a successful (200, status='ok') audit.
export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GscPropertyVariant = 'domain' | 'https' | 'http' | 'https-www' | 'http-www';

export interface GscResolvedProperty {
  siteUrl: string;
  variant: GscPropertyVariant;
}

export interface GscData {
  resolved: GscResolvedProperty;
  startDate: string;
  endDate: string;
  totals: GscTotals;
  topQueries: GscRow[];
  topPages: GscRow[];
}

export type GscResult =
  | { state: 'disabled' }
  | { state: 'property-not-found'; domain: string; sitesAvailable: number }
  | { state: 'api-error'; message: string }
  | { state: 'ok'; data: GscData };

// ============================================================
//  Bing Webmaster Tools (Phase G3)
// ============================================================
// Mirrors the GSC type shape so the UI layer (Bing tab) can reuse
// the existing table component patterns. Auth is a single API key
// in env (BING_WMT_API_KEY); no OAuth flow, no property resolver.
//
//   disabled        — BING_WMT_API_KEY not set in env. Audit ran
//                     without Bing data by design.
//   site-not-found  — key set, but the audit's siteUrl is not in
//                     the verified-sites list of that key.
//   api-error       — key + site OK, but Bing API returned 4xx/5xx
//                     or network error. Audit completes; UI shows
//                     a warning.
//   ok              — happy path. data carries the BingData payload.
//
// All four states result in a successful (200, status='ok') audit.
export interface BingTotals {
  clicks: number;
  impressions: number;
  ctr: number;        // clicks / max(1, impressions); guarded against div-by-zero
  position: number;   // average impression position
}

export interface BingRow {
  // For getQueryStats this is the search term; for getPageStats the URL.
  query?: string;
  page?: string;
  clicks: number;
  impressions: number;
  ctr: number;        // computed at parse time — Bing doesn't include it
  position: number;
}

export interface BingData {
  siteUrl: string;
  // Bing's API returns aggregated data without exposing the underlying
  // window. No startDate/endDate fields here — a synthetic range would
  // be misleading. If Bing ever ships a range-filter, add real values
  // then.
  totals: BingTotals;
  topQueries: BingRow[];
  topPages: BingRow[];
}

export type BingResult =
  | { state: 'disabled' }
  | { state: 'site-not-found'; siteUrl: string }
  | { state: 'api-error'; message: string }
  | { state: 'ok'; data: BingData };

export interface WwwConsistencyInfo {
  canonicalUrl: string;
  variantUrl: string;
  canonicalFinalUrl?: string;
  variantFinalUrl?: string;
  consistent: boolean;
  error?: string;
}

export interface AuditResult {
  config: AuditConfig;
  auditedAt: string;
  domain: string;
  totalScore: number;
  moduleScores: ModuleScore[];
  findings: Finding[];
  strengths_de: string[];
  strengths_en: string[];
  crawlStats: CrawlStats;
  sslInfo?: SSLInfo;
  dnsInfo?: DNSInfo;
  pageSpeedData?: PageSpeedData;
  safeBrowsingData?: SafeBrowsingData;
  securityHeaders?: SecurityHeadersInfo;
  aiReadiness?: AIReadinessInfo;
  sitemapInfo?: SitemapInfo;
  wwwConsistency?: WwwConsistencyInfo;
  pages: PageSEOData[];
  // HEAD-probed image sizes; undefined when the probe was disabled
  // (imageHeadCheckLimit === 0) or when no images were probeable.
  imageSizes?: { url: string; sizeBytes: number; contentType?: string }[];
  // Mobile vs Desktop word-count parity for the sampled pages.
  // Undefined when the probe was disabled or no comparable data.
  mobileDesktopParity?: { url: string; mobileWords: number; desktopWords: number; diffRatio: number }[];
  // JS-mode screenshots (base64-encoded PNGs). Undefined when the
  // capture was disabled or static mode was used.
  screenshots?: { url: string; mobileBase64?: string; desktopBase64?: string }[];
  // Search Console state — always present once G1b ships; one of
  // disabled / property-not-found / api-error / ok. See GscResult.
  gscResult?: GscResult;
  // Bing Webmaster state — always present once G3b ships; one of
  // disabled / site-not-found / api-error / ok. See BingResult.
  bingResult?: BingResult;
  topFindings: Finding[]; // top 5 highest-impact findings, ranked by findingImpactScore
  claudePrompt: string;
  summary_de: string;
  summary_en: string;
}

export interface AuditDiff {
  domain: string;
  currentAudit: AuditResult;
  previousAudit: AuditResult;
  previousAuditDate: string;
  resolved: Finding[]; // in previous but not in current (matched by finding.id)
  new: Finding[];      // in current but not in previous
  unchanged: Finding[]; // in both
  scoreDelta: number;  // current.totalScore - previous.totalScore
  moduleDeltas: { module: string; delta: number }[];
}

export interface AuditProgress {
  stage: string;
  stage_de: string;
  stage_en: string;
  percent: number;
  detail?: string;
}

// SSE event union sent from /api/audit to the client. Single source
// of truth — both route.ts and AuditApp.tsx import it from here so
// the schema can't drift between server and client.
//
// `warning` is non-fatal: emitted mid-stream when an external API
// fails in a way the user should know about, but the audit itself
// completes. The optional `source` lets the client filter or label
// (currently 'gsc'; axe / Browserless / etc. can join later).
export type StreamEvent =
  | { type: 'progress'; step: string; percent: number; detail?: string }
  | { type: 'warning'; source?: string; message: string }
  | { type: 'result'; payload: AuditResult }
  | { type: 'error'; message: string };
