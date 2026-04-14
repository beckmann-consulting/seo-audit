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
}

export interface PageData {
  url: string;
  html: string;
  statusCode: number;
  redirectedFrom?: string;
  loadTime?: number;
  contentType?: string;
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
