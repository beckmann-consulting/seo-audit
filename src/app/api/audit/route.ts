import { NextRequest, NextResponse } from 'next/server';
import { crawlSite } from '@/lib/crawler';
import { extractPageSEO } from '@/lib/extractor';
import {
  checkSSL, checkDNS, checkPageSpeed,
  checkSafeBrowsing, checkRobotsAndSitemap, checkSecurityHeaders,
  checkAIReadiness,
} from '@/lib/external-checks';
import {
  generateSEOFindings, generateContentFindings, generateTechFindings,
  generateLegalFindings, generateUXFindings, generatePerformanceFindings,
  generateSafeBrowsingFindings, generateSecurityHeadersFindings,
  generateHreflangFindings, generateAIReadinessFindings,
  generateStructuredDataFindings, generateDuplicateContentFindings,
  generateCrawlStructureFindings, calculateModuleScore
} from '@/lib/findings-engine';
import { generateClaudePrompt } from '@/lib/claude-prompt';
import type { AuditConfig, AuditResult, ModuleScore, Module, Finding } from '@/types';

export const maxDuration = 300; // 5 min timeout

const MODULE_LABELS: Record<Module, { de: string; en: string }> = {
  seo: { de: 'SEO', en: 'SEO' },
  content: { de: 'Inhalte', en: 'Content' },
  legal: { de: 'Rechtliches', en: 'Legal' },
  ux: { de: 'UX & Struktur', en: 'UX & Structure' },
  tech: { de: 'Technik', en: 'Tech' },
  performance: { de: 'Performance', en: 'Performance' },
  offers: { de: 'Angebote', en: 'Offers' },
};

export async function POST(req: NextRequest) {
  try {
    const config: AuditConfig = await req.json();

    if (!config.url) {
      return NextResponse.json({ error: 'URL required' }, { status: 400 });
    }

    // Normalize URL
    let url = config.url.trim();
    if (!url.startsWith('http')) url = 'https://' + url;
    const domain = new URL(url).hostname;

    // ---- STEP 1: Crawl ----
    const { pages: rawPages, stats: crawlStats } = await crawlSite(url, config.maxPages || 0);

    if (rawPages.length === 0) {
      return NextResponse.json({ error: `Could not fetch ${url}. Check the URL.` }, { status: 422 });
    }

    // ---- STEP 2: Extract SEO data from all pages ----
    const pages = rawPages.map(p => extractPageSEO(p));

    // ---- STEP 3: robots.txt + sitemap ----
    const { hasRobots, hasSitemap, robotsContent } = await checkRobotsAndSitemap(url);
    pages[0].hasRobots = hasRobots;
    pages[0].hasSitemap = hasSitemap;

    // ---- STEP 3b: AI Crawler Readiness ----
    let aiReadiness = undefined;
    if (config.modules.includes('seo')) {
      aiReadiness = await checkAIReadiness(url, robotsContent);
    }

    // ---- STEP 4: SSL ----
    let sslInfo = undefined;
    if (config.modules.includes('tech')) {
      sslInfo = await checkSSL(domain);
    }

    // ---- STEP 5: DNS ----
    let dnsInfo = undefined;
    if (config.modules.includes('tech')) {
      dnsInfo = await checkDNS(domain);
    }

    // ---- STEP 5b: Security Headers ----
    let securityHeaders = undefined;
    if (config.modules.includes('tech')) {
      securityHeaders = await checkSecurityHeaders(url, rawPages[0]?.html);
    }

    // ---- STEP 6: PageSpeed (optional) ----
    let pageSpeedData = undefined;
    if (config.googleApiKey && config.modules.includes('performance')) {
      pageSpeedData = await checkPageSpeed(url, config.googleApiKey);
    }

    // ---- STEP 7: Safe Browsing (optional) ----
    let safeBrowsingData = undefined;
    if (config.googleApiKey) {
      safeBrowsingData = await checkSafeBrowsing(url, config.googleApiKey);
    }

    // ---- STEP 8: Generate findings ----
    const allHtml = rawPages.map(p => p.html).join('\n');
    const allFindings: Finding[] = [];

    if (config.modules.includes('seo')) {
      allFindings.push(...generateSEOFindings(pages, hasRobots, hasSitemap));
      allFindings.push(...generateHreflangFindings(pages));
      allFindings.push(...generateAIReadinessFindings(aiReadiness));
      allFindings.push(...generateStructuredDataFindings(pages));
      allFindings.push(...generateDuplicateContentFindings(pages));
      allFindings.push(...generateCrawlStructureFindings(pages));
    }
    if (config.modules.includes('content')) {
      allFindings.push(...generateContentFindings(pages));
    }
    if (config.modules.includes('tech')) {
      allFindings.push(...generateTechFindings(pages, crawlStats, sslInfo, dnsInfo));
      allFindings.push(...generateSecurityHeadersFindings(securityHeaders));
    }
    if (config.modules.includes('legal')) {
      allFindings.push(...generateLegalFindings(pages, allHtml));
    }
    if (config.modules.includes('ux')) {
      allFindings.push(...generateUXFindings(pages));
    }
    if (config.modules.includes('performance')) {
      allFindings.push(...generatePerformanceFindings(pageSpeedData));
    }
    if (safeBrowsingData) {
      allFindings.push(...generateSafeBrowsingFindings(safeBrowsingData));
    }

    // ---- STEP 9: Scores ----
    const moduleScores: ModuleScore[] = config.modules.map(m => ({
      module: m,
      score: calculateModuleScore(allFindings, m),
      label_de: MODULE_LABELS[m].de,
      label_en: MODULE_LABELS[m].en,
    }));

    // Boost score if PageSpeed is good
    if (pageSpeedData?.seoScore) {
      const seoModule = moduleScores.find(m => m.module === 'seo');
      if (seoModule) {
        seoModule.score = Math.round((seoModule.score + pageSpeedData.seoScore) / 2);
      }
    }

    const totalScore = moduleScores.length > 0
      ? Math.round(moduleScores.reduce((s, m) => s + m.score, 0) / moduleScores.length)
      : 50;

    // ---- STEP 10: Strengths ----
    const strengths_de: string[] = [];
    const strengths_en: string[] = [];

    if (url.startsWith('https://')) {
      strengths_de.push('HTTPS aktiv — sichere Verbindung für alle Besucher.');
      strengths_en.push('HTTPS active — secure connection for all visitors.');
    }
    if (hasRobots) {
      strengths_de.push('robots.txt vorhanden — Suchmaschinen-Crawling korrekt konfiguriert.');
      strengths_en.push('robots.txt present — search engine crawling correctly configured.');
    }
    if (hasSitemap) {
      strengths_de.push('XML-Sitemap vorhanden — hilft Google alle Seiten zu finden.');
      strengths_en.push('XML sitemap present — helps Google find all pages.');
    }
    if (pages.some(p => p.schemaTypes.length > 0)) {
      const types = [...new Set(pages.flatMap(p => p.schemaTypes))].slice(0, 3).join(', ');
      strengths_de.push(`Schema.org Markup vorhanden (${types}) — ermöglicht Rich Snippets.`);
      strengths_en.push(`Schema.org markup present (${types}) — enables rich snippets.`);
    }
    if (sslInfo?.grade && ['A+', 'A', 'A-'].includes(sslInfo.grade)) {
      strengths_de.push(`Hervorragende SSL-Konfiguration (Grade ${sslInfo.grade}).`);
      strengths_en.push(`Excellent SSL configuration (Grade ${sslInfo.grade}).`);
    }
    if (pageSpeedData?.performanceScore && pageSpeedData.performanceScore >= 75) {
      strengths_de.push(`Guter PageSpeed Score: ${pageSpeedData.performanceScore}/100.`);
      strengths_en.push(`Good PageSpeed score: ${pageSpeedData.performanceScore}/100.`);
    }
    if (crawlStats.brokenLinks.length === 0) {
      strengths_de.push('Keine defekten Links gefunden — saubere Link-Struktur.');
      strengths_en.push('No broken links found — clean link structure.');
    }

    // Ensure at least 3 strengths
    if (strengths_de.length < 3) {
      strengths_de.push(`${crawlStats.crawledPages} Seiten erfolgreich gecrawlt.`);
      strengths_en.push(`${crawlStats.crawledPages} pages successfully crawled.`);
    }

    // ---- STEP 11: Summary ----
    const criticalCount = allFindings.filter(f => f.priority === 'critical').length;
    const importantCount = allFindings.filter(f => f.priority === 'important').length;
    const scoreLabel_de = totalScore >= 75 ? 'gut' : totalScore >= 50 ? 'verbesserungswürdig' : 'kritisch';
    const scoreLabel_en = totalScore >= 75 ? 'good' : totalScore >= 50 ? 'needs improvement' : 'critical';

    const summary_de = `${domain} erreicht einen Gesamt-SEO-Score von ${totalScore}/100 (${scoreLabel_de}). Es wurden ${crawlStats.crawledPages} Seiten gecrawlt und ${allFindings.length} Findings identifiziert — davon ${criticalCount} kritische und ${importantCount} wichtige. ${criticalCount > 0 ? 'Die kritischen Punkte sollten sofort behoben werden.' : 'Die wichtigsten Verbesserungspotenziale liegen in den unten aufgeführten Empfehlungen.'}`;
    const summary_en = `${domain} achieves an overall SEO score of ${totalScore}/100 (${scoreLabel_en}). ${crawlStats.crawledPages} pages were crawled and ${allFindings.length} findings were identified — ${criticalCount} critical and ${importantCount} important. ${criticalCount > 0 ? 'The critical issues should be addressed immediately.' : 'The main improvement potential lies in the recommendations listed below.'}`;

    // ---- STEP 12: Claude prompt ----
    const auditResult: AuditResult = {
      config: { ...config, url },
      auditedAt: new Date().toISOString(),
      domain,
      totalScore,
      moduleScores,
      findings: allFindings,
      strengths_de,
      strengths_en,
      crawlStats,
      sslInfo,
      dnsInfo,
      pageSpeedData,
      safeBrowsingData,
      securityHeaders,
      aiReadiness,
      pages,
      claudePrompt: '',
      summary_de,
      summary_en,
    };

    auditResult.claudePrompt = generateClaudePrompt(auditResult);

    return NextResponse.json(auditResult);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Audit error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
