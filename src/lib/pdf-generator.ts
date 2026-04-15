'use client';

import type { AuditResult, Lang, Finding, ModuleScore } from '@/types';

const PRIORITY_COLORS: Record<string, [number, number, number]> = {
  critical: [163, 45, 45],
  important: [133, 79, 11],
  recommended: [24, 95, 165],
  optional: [80, 80, 80],
};

const PRIORITY_LABELS: Record<string, Record<Lang, string>> = {
  critical: { de: 'Kritisch', en: 'Critical' },
  important: { de: 'Wichtig', en: 'Important' },
  recommended: { de: 'Empfohlen', en: 'Recommended' },
  optional: { de: 'Optional', en: 'Optional' },
};

const EFFORT_LABELS: Record<string, Record<Lang, string>> = {
  low: { de: 'Aufwand: gering', en: 'Effort: low' },
  medium: { de: 'Aufwand: mittel', en: 'Effort: medium' },
  high: { de: 'Aufwand: hoch', en: 'Effort: high' },
};

const IMPACT_LABELS: Record<string, Record<Lang, string>> = {
  low: { de: 'Impact: gering', en: 'Impact: low' },
  medium: { de: 'Impact: mittel', en: 'Impact: medium' },
  high: { de: 'Impact: hoch', en: 'Impact: high' },
};

export async function generatePDF(result: AuditResult, lang: Lang): Promise<void> {
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  const isDE = lang === 'de';
  const W = 210;
  const margin = 18;
  const contentW = W - margin * 2;
  let y = margin;

  const checkPage = (needed: number = 12) => {
    if (y + needed > 283) { doc.addPage(); y = margin; }
  };

  const scoreColor = (s: number): [number, number, number] =>
    s >= 75 ? [55, 109, 17] : s >= 50 ? [133, 79, 11] : [163, 45, 45];

  // ============================================================
  //  COVER PAGE
  // ============================================================
  doc.setFillColor(15, 15, 15);
  doc.rect(0, 0, W, 75, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(isDE ? 'Website Audit Bericht' : 'Website Audit Report', margin, 28);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.setTextColor(200, 200, 200);
  doc.text(result.domain, margin, 39);

  doc.setFontSize(9);
  doc.setTextColor(150, 150, 150);
  const dateStr = new Date(result.auditedAt).toLocaleDateString(isDE ? 'de-DE' : 'en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.text(`${isDE ? 'Erstellt' : 'Created'}: ${dateStr} · ${result.config.author} · ${isDE ? 'Deutsch' : 'English'}`, margin, 49);
  doc.text(`${isDE ? 'Gecrawlte Seiten' : 'Pages crawled'}: ${result.crawlStats.crawledPages} · ${isDE ? 'Defekte Links' : 'Broken links'}: ${result.crawlStats.brokenLinks.length}`, margin, 57);

  // Overall score — big
  const [sr, sg, sb] = scoreColor(result.totalScore);
  doc.setTextColor(sr, sg, sb);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(52);
  doc.text(String(result.totalScore), W - margin - 28, 52, { align: 'right' });
  doc.setFontSize(14);
  doc.setTextColor(180, 180, 180);
  doc.text(isDE ? 'Gesamtscore' : 'Overall Score', W - margin - 28, 62, { align: 'right' });
  doc.setFontSize(10);
  doc.text('· out of 100', W - margin - 28, 69, { align: 'right' });

  y = 88;

  // Module score tiles
  const tileW = (contentW - 10) / 3;
  const tileH = 22;
  result.moduleScores.forEach((ms, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const tx = margin + col * (tileW + 5);
    const ty = y + row * (tileH + 5);
    const [mr, mg, mb] = scoreColor(ms.score);

    doc.setFillColor(245, 245, 243);
    doc.roundedRect(tx, ty, tileW, tileH, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(mr, mg, mb);
    doc.text(String(ms.score), tx + tileW / 2, ty + 12, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(80, 80, 80);
    doc.text(isDE ? ms.label_de : ms.label_en, tx + tileW / 2, ty + 18.5, { align: 'center' });
  });

  const tileRows = Math.ceil(result.moduleScores.length / 3);
  y += tileRows * (tileH + 5) + 10;

  // ============================================================
  //  EXECUTIVE SUMMARY
  // ============================================================
  checkPage(30);
  doc.setDrawColor(220, 220, 218);
  doc.setLineWidth(0.3);
  doc.line(margin, y, W - margin, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 15, 15);
  doc.text(isDE ? 'Zusammenfassung' : 'Executive Summary', margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(50, 50, 50);
  const summary = isDE ? result.summary_de : result.summary_en;
  const summaryLines = doc.splitTextToSize(summary, contentW);
  checkPage(summaryLines.length * 5 + 10);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 5 + 10;

  // Quick stats bar
  checkPage(12);
  const stats = [
    { label: isDE ? 'Findings' : 'Findings', value: String(result.findings.length) },
    { label: isDE ? 'Kritisch' : 'Critical', value: String(result.findings.filter(f => f.priority === 'critical').length), color: [163, 45, 45] as [number, number, number] },
    { label: isDE ? 'Wichtig' : 'Important', value: String(result.findings.filter(f => f.priority === 'important').length), color: [133, 79, 11] as [number, number, number] },
    { label: isDE ? 'Seiten gecrawlt' : 'Pages crawled', value: String(result.crawlStats.crawledPages) },
  ];
  const statW = contentW / stats.length;
  stats.forEach((s, i) => {
    const sx = margin + i * statW;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    if (s.color) doc.setTextColor(...s.color);
    else doc.setTextColor(15, 15, 15);
    doc.text(s.value, sx + statW / 2, y + 6, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(s.label, sx + statW / 2, y + 11, { align: 'center' });
  });
  y += 18;

  doc.line(margin, y, W - margin, y);
  y += 8;

  // ============================================================
  //  FINDINGS
  // ============================================================
  checkPage(10);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 15, 15);
  doc.text(isDE ? 'Verbesserungsempfehlungen' : 'Improvement Recommendations', margin, y);
  y += 8;

  // Sort: critical first
  const priorityOrder = { critical: 0, important: 1, recommended: 2, optional: 3 };
  const sortedFindings = [...result.findings].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  sortedFindings.forEach((finding: Finding) => {
    const title = isDE ? finding.title_de : finding.title_en;
    const desc = isDE ? finding.description_de : finding.description_en;
    const rec = isDE ? finding.recommendation_de : finding.recommendation_en;
    const module = finding.module.charAt(0).toUpperCase() + finding.module.slice(1);

    const descLines = doc.splitTextToSize(desc, contentW - 4);
    const recLines = doc.splitTextToSize(`→ ${rec}`, contentW - 4);
    const rowH = 10 + descLines.length * 4.2 + recLines.length * 4.2 + 6;
    checkPage(rowH + 4);

    // Priority badge
    const [pr, pg, pb] = PRIORITY_COLORS[finding.priority];
    doc.setFillColor(pr, pg, pb);
    doc.roundedRect(margin, y - 4, 22, 5.5, 1, 1, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(255, 255, 255);
    doc.text(PRIORITY_LABELS[finding.priority][lang], margin + 11, y, { align: 'center' });

    // Module + effort + impact
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text(`${module} · ${EFFORT_LABELS[finding.effort][lang]} · ${IMPACT_LABELS[finding.impact][lang]}`, margin + 25, y);

    y += 5;

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 15, 15);
    const titleLines = doc.splitTextToSize(title, contentW);
    checkPage(titleLines.length * 5 + 2);
    doc.text(titleLines, margin, y);
    y += titleLines.length * 5;

    // Description
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(55, 55, 55);
    checkPage(descLines.length * 4.2 + 2);
    doc.text(descLines, margin, y);
    y += descLines.length * 4.2 + 1;

    // Recommendation
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(pr, pg, pb);
    checkPage(recLines.length * 4.2 + 2);
    doc.text(recLines, margin, y);
    y += recLines.length * 4.2 + 6;

    // Divider
    doc.setDrawColor(235, 235, 230);
    doc.line(margin, y, W - margin, y);
    y += 5;
  });

  // ============================================================
  //  STRENGTHS
  // ============================================================
  checkPage(20);
  y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(15, 15, 15);
  doc.text(isDE ? 'Was gut ist' : "What's Working Well", margin, y);
  y += 7;

  const strengths = isDE ? result.strengths_de : result.strengths_en;
  strengths.forEach(s => {
    checkPage(10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(55, 109, 17);
    doc.text('✓', margin, y);
    doc.setTextColor(40, 40, 40);
    const lines = doc.splitTextToSize(s, contentW - 6);
    doc.text(lines, margin + 5, y);
    y += lines.length * 4.8 + 2;
  });

  // ============================================================
  //  TECHNICAL DETAILS (all modules)
  // ============================================================
  const techRow = (label: string, value: string, ok: boolean = true) => {
    checkPage(6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(label, margin + 2, y);
    if (ok) doc.setTextColor(30, 30, 30);
    else doc.setTextColor(163, 45, 45);
    const valueLines = doc.splitTextToSize(value, contentW - 60);
    doc.text(valueLines, margin + 55, y);
    y += valueLines.length * 4 + 1;
  };

  const techHeading = (title: string) => {
    checkPage(14);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 15, 15);
    doc.text(title, margin, y);
    y += 5;
    doc.setDrawColor(230, 230, 226);
    doc.line(margin, y, W - margin, y);
    y += 3;
  };

  const hasAnyTechData =
    result.sslInfo || result.dnsInfo || result.pageSpeedData ||
    result.securityHeaders || result.aiReadiness || result.sitemapInfo ||
    result.safeBrowsingData;

  if (hasAnyTechData) {
    checkPage(20);
    y += 6;
    doc.setDrawColor(200, 200, 195);
    doc.line(margin, y, W - margin, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 15, 15);
    doc.text(isDE ? 'Technische Details' : 'Technical Details', margin, y);
    y += 7;

    // SSL / TLS
    if (result.sslInfo) {
      techHeading(isDE ? 'SSL / TLS' : 'SSL / TLS');
      const ssl = result.sslInfo;
      techRow(isDE ? 'Grade' : 'Grade', ssl.grade || (isDE ? 'unbekannt' : 'unknown'), ['A+', 'A', 'A-', 'B'].includes(ssl.grade || ''));
      techRow(isDE ? 'Gültig' : 'Valid', ssl.valid ? '✓' : '✗', ssl.valid);
      if (ssl.daysUntilExpiry !== undefined) {
        techRow(
          isDE ? 'Läuft ab in' : 'Expires in',
          `${ssl.daysUntilExpiry} ${isDE ? 'Tagen' : 'days'}`,
          ssl.daysUntilExpiry > 30
        );
      }
      if (ssl.issuer) techRow(isDE ? 'Aussteller' : 'Issuer', ssl.issuer);
      if (ssl.protocols && ssl.protocols.length > 0) {
        techRow(isDE ? 'Protokolle' : 'Protocols', ssl.protocols.join(', '));
      }
    }

    // DNS
    if (result.dnsInfo) {
      techHeading(isDE ? 'DNS & E-Mail' : 'DNS & Email');
      techRow('SPF', result.dnsInfo.hasSPF ? '✓' : (isDE ? 'fehlt' : 'missing'), result.dnsInfo.hasSPF);
      techRow('DKIM', result.dnsInfo.hasDKIM ? '✓' : (isDE ? 'fehlt' : 'missing'), result.dnsInfo.hasDKIM);
      techRow('DMARC', result.dnsInfo.hasDMARC ? '✓' : (isDE ? 'fehlt' : 'missing'), result.dnsInfo.hasDMARC);
      if (result.dnsInfo.mxRecords && result.dnsInfo.mxRecords.length > 0) {
        techRow('MX', result.dnsInfo.mxRecords.join(', '));
      }
    }

    // PageSpeed — includes INP + FID field data alongside lab metrics
    if (result.pageSpeedData && !result.pageSpeedData.error) {
      techHeading(isDE ? 'PageSpeed (Mobile) & Core Web Vitals' : 'PageSpeed (Mobile) & Core Web Vitals');
      const ps = result.pageSpeedData;
      if (ps.performanceScore !== undefined) {
        techRow('Performance', `${ps.performanceScore}/100`, ps.performanceScore >= 50);
      }
      if (ps.seoScore !== undefined) {
        techRow('SEO', `${ps.seoScore}/100`, ps.seoScore >= 75);
      }
      if (ps.accessibilityScore !== undefined) {
        techRow(isDE ? 'Zugänglichkeit' : 'Accessibility', `${ps.accessibilityScore}/100`, ps.accessibilityScore >= 75);
      }
      if (ps.bestPracticesScore !== undefined) {
        techRow(isDE ? 'Best Practices' : 'Best Practices', `${ps.bestPracticesScore}/100`, ps.bestPracticesScore >= 75);
      }
      if (ps.lcp !== undefined) techRow('LCP', `${Math.round(ps.lcp / 100) / 10}s`, ps.lcp < 2500);
      if (ps.cls !== undefined) techRow('CLS', ps.cls.toFixed(3), ps.cls < 0.1);
      if (ps.inp !== undefined) techRow('INP', `${Math.round(ps.inp)}ms`, ps.inp < 200);
      if (ps.fidField !== undefined) techRow(isDE ? 'FID (Feld)' : 'FID (field)', `${Math.round(ps.fidField)}ms`, ps.fidField < 100);
      if (ps.fcp !== undefined) techRow('FCP', `${Math.round(ps.fcp / 100) / 10}s`, ps.fcp < 1800);
      if (ps.ttfb !== undefined) techRow('TTFB', `${Math.round(ps.ttfb)}ms`, ps.ttfb < 800);
      if (ps.tbt !== undefined) techRow('TBT', `${Math.round(ps.tbt)}ms`, ps.tbt < 200);
    }

    // Security Headers
    if (result.securityHeaders && !result.securityHeaders.error) {
      techHeading(isDE ? 'Security Headers' : 'Security Headers');
      const sh = result.securityHeaders;
      techRow(
        'HSTS',
        sh.hsts ? (sh.hstsMaxAge ? `max-age=${sh.hstsMaxAge}` : (isDE ? 'gesetzt' : 'set')) : (isDE ? 'fehlt' : 'missing'),
        !!sh.hsts && (sh.hstsMaxAge ?? 0) >= 15552000
      );
      techRow('X-Content-Type-Options', sh.xContentTypeOptions || (isDE ? 'fehlt' : 'missing'), sh.xContentTypeOptions?.toLowerCase() === 'nosniff');
      const frameOk = !!sh.xFrameOptions || /frame-ancestors/i.test(sh.csp || '');
      techRow(
        'X-Frame-Options',
        sh.xFrameOptions || (frameOk ? (isDE ? 'via CSP' : 'via CSP') : (isDE ? 'fehlt' : 'missing')),
        frameOk
      );
      techRow('CSP', sh.csp ? (isDE ? 'gesetzt' : 'set') : (isDE ? 'fehlt' : 'missing'), !!sh.csp);
      techRow('Referrer-Policy', sh.referrerPolicy || (isDE ? 'fehlt' : 'missing'), !!sh.referrerPolicy);
      techRow('Permissions-Policy', sh.permissionsPolicy ? (isDE ? 'gesetzt' : 'set') : (isDE ? 'fehlt' : 'missing'), !!sh.permissionsPolicy);
      if (sh.hasCookieSecure === false) {
        techRow(isDE ? 'Cookie Secure-Flag' : 'Cookie Secure flag', isDE ? 'fehlt' : 'missing', false);
      }
      if (sh.hasMixedContent) {
        techRow('Mixed Content', isDE ? 'erkannt' : 'detected', false);
      }
    }

    // AI Crawler Readiness
    if (result.aiReadiness && !result.aiReadiness.error) {
      techHeading(isDE ? 'AI Crawler Readiness' : 'AI Crawler Readiness');
      const ai = result.aiReadiness;
      techRow('llms.txt', ai.hasLlmsTxt ? (isDE ? 'vorhanden' : 'present') : (isDE ? 'fehlt' : 'missing'), ai.hasLlmsTxt);
      techRow('llms-full.txt', ai.hasLlmsFullTxt ? (isDE ? 'vorhanden' : 'present') : (isDE ? 'fehlt' : 'missing'), ai.hasLlmsFullTxt);
      for (const b of ai.bots) {
        const valueText = b.status === 'allowed'
          ? (isDE ? 'erlaubt' : 'allowed')
          : b.status === 'blocked'
            ? (isDE ? 'blockiert' : 'blocked')
            : b.status === 'partial'
              ? (isDE ? 'teilweise' : 'partial')
              : (isDE ? 'nicht geregelt' : 'unspecified');
        // Training bots blocked = good (opt-out), retrieval bots blocked = bad
        const ok = b.status === 'allowed' || (b.purpose === 'training' && b.status === 'blocked');
        techRow(`${b.bot} (${b.purpose})`, valueText, ok);
      }
    }

    // Sitemap Coverage
    if (result.sitemapInfo && !result.sitemapInfo.error) {
      techHeading(isDE ? 'Sitemap Coverage' : 'Sitemap Coverage');
      const sm = result.sitemapInfo;
      techRow(isDE ? 'URLs in Sitemap' : 'URLs in sitemap', String(sm.urls.length));
      techRow(isDE ? 'Sitemap-Index' : 'Sitemap index', sm.isIndex ? (isDE ? 'ja' : 'yes') : (isDE ? 'nein' : 'no'));
      if (sm.isIndex) {
        techRow(isDE ? 'Sub-Sitemaps' : 'Sub-sitemaps', String(sm.subSitemaps.length));
      }
      const withLastmod = sm.urls.filter(e => !!e.lastmod).length;
      techRow(isDE ? 'Mit lastmod' : 'With lastmod', `${withLastmod}/${sm.urls.length}`, withLastmod > 0);
      const withImages = sm.urls.filter(e => e.imageCount > 0).length;
      techRow(isDE ? 'Mit Bild-Einträgen' : 'With image entries', String(withImages));

      const crawledSet = new Set(result.pages.map(p => p.url));
      const sitemapSet = new Set(sm.urls.map(e => e.url));
      const missingFromCrawl = [...sitemapSet].filter(u => !crawledSet.has(u)).length;
      const missingFromSitemap = [...crawledSet].filter(u => !sitemapSet.has(u)).length;
      techRow(
        isDE ? 'In Sitemap, nicht gecrawlt' : 'In sitemap, not crawled',
        String(missingFromCrawl),
        missingFromCrawl === 0
      );
      techRow(
        isDE ? 'Gecrawlt, nicht in Sitemap' : 'Crawled, not in sitemap',
        String(missingFromSitemap),
        missingFromSitemap === 0
      );
    }

    // Redirects (aggregated from pages + crawlStats)
    const redirected = result.pages.filter(p => p.redirectChain && p.redirectChain.length > 0);
    const chainPages = redirected.filter(p => p.redirectChain.length > 1);
    const loopPages = redirected.filter(p => {
      const seen = new Set<string>();
      for (const hop of p.redirectChain) {
        if (seen.has(hop)) return true;
        seen.add(hop);
      }
      return p.redirectChain.includes(p.finalUrl);
    });
    const downgradePages = redirected.filter(p =>
      p.redirectChain[0]?.startsWith('https://') && p.finalUrl.startsWith('http://')
    );
    if (redirected.length > 0 || result.crawlStats.redirectChains.length > 0) {
      techHeading(isDE ? 'Redirects' : 'Redirects');
      techRow(isDE ? 'Mit Redirect gecrawlt' : 'Crawled via redirect', String(redirected.length), redirected.length === 0);
      techRow(isDE ? 'Ketten (>1 Hop)' : 'Chains (>1 hop)', String(chainPages.length), chainPages.length === 0);
      techRow(isDE ? 'Schleifen' : 'Loops', String(loopPages.length), loopPages.length === 0);
      techRow('HTTPS → HTTP', String(downgradePages.length), downgradePages.length === 0);
    }

    // Link Quality (generic anchors + empty anchors + noindex)
    const totalGeneric = result.pages.reduce((s, p) => s + (p.genericAnchors?.length || 0), 0);
    const totalEmpty = result.pages.reduce((s, p) => s + (p.emptyAnchors || 0), 0);
    const noindexPages = result.pages.filter(p => p.hasNoindex).length;
    if (totalGeneric > 0 || totalEmpty > 0 || noindexPages > 0) {
      techHeading(isDE ? 'Link Quality' : 'Link Quality');
      techRow(isDE ? 'Generische Ankertexte' : 'Generic anchor texts', String(totalGeneric), totalGeneric === 0);
      techRow(isDE ? 'Links ohne Text' : 'Links without text', String(totalEmpty), totalEmpty === 0);
      techRow(isDE ? 'Seiten mit noindex' : 'Pages with noindex', String(noindexPages));
    }

    // Safe Browsing
    if (result.safeBrowsingData) {
      techHeading(isDE ? 'Google Safe Browsing' : 'Google Safe Browsing');
      techRow(
        isDE ? 'Status' : 'Status',
        result.safeBrowsingData.isSafe ? (isDE ? 'Sicher' : 'Safe') : (isDE ? 'GEFÄHRLICH' : 'DANGEROUS'),
        result.safeBrowsingData.isSafe
      );
      if (result.safeBrowsingData.threats && result.safeBrowsingData.threats.length > 0) {
        techRow(isDE ? 'Bedrohungen' : 'Threats', result.safeBrowsingData.threats.join(', '), false);
      }
    }

    // Crawl Statistics
    techHeading(isDE ? 'Crawl-Statistik' : 'Crawl Statistics');
    techRow(isDE ? 'Seiten gecrawlt' : 'Pages crawled', String(result.crawlStats.crawledPages));
    techRow(isDE ? 'Defekte Links' : 'Broken links', String(result.crawlStats.brokenLinks.length), result.crawlStats.brokenLinks.length === 0);
    techRow(isDE ? 'Weiterleitungen' : 'Redirects', String(result.crawlStats.redirectChains.length), result.crawlStats.redirectChains.length < 3);
    techRow(isDE ? 'Externe Links' : 'External links', String(result.crawlStats.externalLinks));
    y += 4;
  }

  // ============================================================
  //  PAGE-BY-PAGE APPENDIX
  // ============================================================
  if (result.pages.length > 1) {
    checkPage(20);
    y += 6;
    doc.setDrawColor(200, 200, 195);
    doc.line(margin, y, W - margin, y);
    y += 8;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 15, 15);
    doc.text(isDE ? 'Seitenanalyse (alle gecrawlten Seiten)' : 'Page Analysis (all crawled pages)', margin, y);
    y += 7;

    result.pages.forEach((p, i) => {
      checkPage(30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 15, 15);
      doc.text(`${i + 1}. ${p.url}`, margin, y);
      y += 5;

      const rows: [string, string][] = [
        [isDE ? 'Title' : 'Title', p.title ? `"${p.title}" (${p.titleLength} ${isDE ? 'Zeichen' : 'chars'})` : (isDE ? 'FEHLT' : 'MISSING')],
        [isDE ? 'Meta Description' : 'Meta Description', p.metaDescription ? `${p.metaDescriptionLength} ${isDE ? 'Zeichen' : 'chars'}` : (isDE ? 'FEHLT' : 'MISSING')],
        ['H1', p.h1s.length > 0 ? `"${p.h1s[0].substring(0, 60)}"${p.h1s.length > 1 ? ` (+${p.h1s.length - 1})` : ''}` : (isDE ? 'FEHLT' : 'MISSING')],
        [isDE ? 'Schema' : 'Schema', p.schemaTypes.length > 0 ? p.schemaTypes.join(', ') : (isDE ? 'keines' : 'none')],
        [isDE ? 'Wörter' : 'Words', String(p.wordCount)],
        [isDE ? 'Bilder ohne Alt' : 'Images missing alt', `${p.imagesMissingAlt}/${p.totalImages}`],
        [isDE ? 'Klicktiefe' : 'Click depth', String(p.depth)],
      ];

      if (p.inlinkCount !== undefined) {
        rows.push([isDE ? 'Interne Inlinks' : 'Internal inlinks', String(p.inlinkCount)]);
      }
      if (p.hasNoindex) {
        rows.push([isDE ? 'Robots' : 'Robots', 'noindex']);
      }
      if (p.redirectChain && p.redirectChain.length > 0) {
        const chainStr = p.redirectChain.concat(p.finalUrl).join(' → ');
        rows.push([
          isDE ? 'Redirect-Kette' : 'Redirect chain',
          chainStr.length > 120 ? chainStr.slice(0, 120) + '…' : chainStr,
        ]);
      }
      if (p.genericAnchors && p.genericAnchors.length > 0) {
        rows.push([
          isDE ? 'Generische Anker' : 'Generic anchors',
          `${p.genericAnchors.length} (${p.genericAnchors.slice(0, 2).map(a => `"${a.text}"`).join(', ')}${p.genericAnchors.length > 2 ? '...' : ''})`,
        ]);
      }
      if (p.hreflangs && p.hreflangs.length > 0) {
        rows.push([
          'Hreflang',
          p.hreflangs.map(h => h.hreflang).join(', '),
        ]);
      }
      if (p.likelyClientRendered) {
        rows.push([
          isDE ? 'JS-Rendering' : 'JS rendering',
          p.clientRenderSignal || (isDE ? 'clientseitig gerendert' : 'client-side rendered'),
        ]);
      }

      rows.forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text(label + ':', margin + 2, y);
        doc.setTextColor(30, 30, 30);
        const valueLines = doc.splitTextToSize(value, contentW - 45);
        doc.text(valueLines, margin + 40, y);
        y += valueLines.length * 4 + 1;
      });
      y += 3;
      doc.setDrawColor(240, 240, 238);
      doc.line(margin, y, W - margin, y);
      y += 4;
    });
  }

  // ============================================================
  //  FOOTER on every page
  // ============================================================
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text(
      `${result.domain} · ${result.config.author} · ${dateStr} · ${isDE ? 'Seite' : 'Page'} ${i}/${totalPages}`,
      W / 2, 292, { align: 'center' }
    );
  }

  const filename = `${result.domain}-audit-${lang.toUpperCase()}-${new Date(result.auditedAt).toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
