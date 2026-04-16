// ============================================================
//  TYPES — SEO Audit Pro
// ============================================================

export type Priority = 'critical' | 'important' | 'recommended' | 'optional';
export type Effort = 'low' | 'medium' | 'high';
export type Impact = 'low' | 'medium' | 'high';
export type Lang = 'de' | 'en';

export type Module =
  | 'seo'
  | 'content'
  | 'legal'
  | 'ux'
  | 'tech'
  | 'performance'
  | 'offers';

export interface AuditConfig {
  url: string;
  googleApiKey?: string;
  modules: Module[];
  author: string;
  maxPages: number; // 0 = unlimited
  quickMode?: boolean; // when true, PSI runs once (default: run twice and average for score stability)
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
}

export interface DNSInfo {
  hasSPF: boolean;
  hasDKIM: boolean;
  hasDMARC: boolean;
  spfRecord?: string;
  dmarcRecord?: string;
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
  metaDescription?: string;
  metaDescriptionLength?: number;
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
}

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
