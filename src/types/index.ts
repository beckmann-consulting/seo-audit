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
  claudeApiKey?: string;
  modules: Module[];
  author: string;
  maxPages: number; // 0 = unlimited
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
  twitterCard?: string;
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
  pages: PageSEOData[];
  claudePrompt: string;
  summary_de: string;
  summary_en: string;
}

export interface AuditProgress {
  stage: string;
  stage_de: string;
  stage_en: string;
  percent: number;
  detail?: string;
}
