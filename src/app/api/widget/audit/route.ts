import { NextRequest, NextResponse } from 'next/server';
import { crawlSite } from '@/lib/crawler';
import { extractPageSEO } from '@/lib/extractor';
import {
  checkRobotsAndSitemap, checkPageSpeed, checkSecurityHeaders,
} from '@/lib/external-checks';
import {
  generateSEOFindings, generateContentFindings, generateTechFindings,
  generatePerformanceFindings, generateSecurityHeadersFindings,
  getTopFindings, calculateModuleScore,
} from '@/lib/findings-engine';
import type { Finding, Module } from '@/types';

export const maxDuration = 60;

// ============================================================
//  CORS
// ============================================================
// Widget embeds on beckmanndigital.com in production; localhost
// entries allow the widget page to call this API during `next dev`.
// Unknown origins fall back to the production domain so the header
// is always a valid single origin (CORS spec requires that).
const ALLOWED_ORIGINS: string[] = [
  'https://beckmanndigital.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
];

function getAllowedOrigin(request: Request): string {
  const origin = request.headers.get('origin') || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function corsHeaders(request: Request): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getAllowedOrigin(request),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    // Proxies must cache per-Origin since the allow-origin varies.
    'Vary': 'Origin',
  };
}

export async function OPTIONS(request: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

// ============================================================
//  Simple in-memory rate limit — 3 audits per IP per hour.
//  In-memory map resets on deploy; acceptable for a public widget
//  front door that already has bot-protection at the edge.
// ============================================================
const RATE_LIMIT_PER_HOUR = 3;
const rateLimitMap: Map<string, number[]> = new Map();

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const timestamps = (rateLimitMap.get(ip) || []).filter(t => t > oneHourAgo);
  if (timestamps.length >= RATE_LIMIT_PER_HOUR) {
    rateLimitMap.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  return true;
}

interface WidgetRequestBody {
  url?: string;
  email?: string;
  lang?: 'de' | 'en';
  emailCapture?: boolean;
}

// Forward lead to PHP mailer (beckmanndigital.com/seo-lead.php). Non-blocking:
// a mail failure must never break the audit response, so we swallow errors.
async function forwardLead(
  domain: string,
  email: string,
  lang: 'de' | 'en',
  ip: string,
): Promise<void> {
  const url = process.env.LEAD_WEBHOOK_URL;
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!url || !secret) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Lead-Token': secret,
      },
      body: JSON.stringify({ domain, email, lang, ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[widget-lead] webhook returned ${res.status}`);
    }
  } catch (err) {
    console.error('[widget-lead] webhook failed:', err instanceof Error ? err.message : err);
  }
}

interface WidgetAuditResponse {
  domain: string;
  score: number;
  topFindings: Finding[];
  moduleScores: { module: string; score: number }[];
  auditDuration: number;
}

// ============================================================
//  POST handler
// ============================================================
export async function POST(req: NextRequest) {
  const headers = corsHeaders(req);
  const respond = (status: number, body: unknown) =>
    NextResponse.json(body, { status, headers });

  let body: WidgetRequestBody;
  try {
    body = await req.json();
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const ip = getClientIp(req);

  // Email-only capture path — log, forward to mailer, return. No audit rerun.
  if (body.emailCapture && body.email) {
    const domain = body.url ? safeHostname(body.url) : 'unknown';
    const lang = body.lang === 'en' ? 'en' : 'de';
    console.log(
      `[widget-lead] ${new Date().toISOString()} domain=${domain} email=${body.email} ip=${ip}`
    );
    await forwardLead(domain, body.email, lang, ip);
    return respond(200, { ok: true });
  }

  if (!body.url) {
    return respond(400, { error: 'URL required' });
  }

  if (!checkRateLimit(ip)) {
    return respond(429, { error: 'rate_limited' });
  }

  // Normalise URL
  let url = body.url.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return respond(400, { error: 'invalid_url' });
  }

  const started = Date.now();

  try {
    // Crawl only the homepage
    const { pages: rawPages } = await crawlSite(url, 1);
    if (rawPages.length === 0) {
      return respond(422, { error: 'unreachable', message: `Could not fetch ${url}` });
    }
    const pages = rawPages.map(p => extractPageSEO(p));

    // robots.txt + sitemap check (fast — ~1-2s)
    const { hasRobots, hasSitemap, sitemapUrl } = await checkRobotsAndSitemap(url);
    pages[0].hasRobots = hasRobots;
    pages[0].hasSitemap = hasSitemap;
    // We intentionally skip fetchSitemap() here — the full URL list is
    // irrelevant for a homepage-only mini-audit.
    void sitemapUrl;

    // Security Headers
    const securityHeaders = await checkSecurityHeaders(url, rawPages[0]?.html);

    // PageSpeed — single run (quickMode); only when a server key is set
    const googleKey = process.env.GOOGLE_API_KEY || '';
    const pageSpeedData = googleKey
      ? await checkPageSpeed(url, googleKey, 1)
      : undefined;

    // Generate a focused subset of findings. Tech without SSL/DNS,
    // no Safe Browsing, no legal/ux since a one-page widget audit
    // can't meaningfully assess those.
    const allFindings: Finding[] = [];
    // crawlStats shape required by generateTechFindings
    const crawlStats = {
      totalPages: 1,
      crawledPages: 1,
      brokenLinks: [],
      redirectChains: [],
      externalLinks: 0,
      errorPages: [],
    };
    allFindings.push(...generateSEOFindings(pages, hasRobots, hasSitemap));
    allFindings.push(...generateContentFindings(pages));
    allFindings.push(...generateTechFindings(pages, crawlStats, undefined, undefined));
    allFindings.push(...generateSecurityHeadersFindings(securityHeaders));
    allFindings.push(...generatePerformanceFindings(pageSpeedData, pages));

    // Score per module (only those we actually checked)
    const modulesInPlay: Module[] = ['seo', 'content', 'tech', 'performance'];
    const moduleScores = modulesInPlay.map(m => ({
      module: m,
      score: calculateModuleScore(allFindings, m),
    }));

    const overallScore = moduleScores.length > 0
      ? Math.round(moduleScores.reduce((s, m) => s + m.score, 0) / moduleScores.length)
      : 50;

    const payload: WidgetAuditResponse = {
      domain,
      score: overallScore,
      topFindings: getTopFindings(allFindings, 3),
      moduleScores,
      auditDuration: Date.now() - started,
    };

    // Optional lead capture attached to the same audit response
    if (body.email) {
      const lang = body.lang === 'en' ? 'en' : 'de';
      console.log(
        `[widget-lead] ${new Date().toISOString()} domain=${domain} email=${body.email} ip=${ip}`
      );
      await forwardLead(domain, body.email, lang, ip);
    }

    return respond(200, payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[widget-audit] failed:', message);
    return respond(500, { error: 'audit_failed', message });
  }
}

function safeHostname(urlLike: string): string {
  let u = urlLike.trim();
  if (!u.startsWith('http')) u = 'https://' + u;
  try {
    return new URL(u).hostname;
  } catch {
    return urlLike;
  }
}
