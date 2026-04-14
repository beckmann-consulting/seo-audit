import type { AuditResult } from '@/types';

export function generateClaudePrompt(result: AuditResult): string {
  const criticalFindings = result.findings.filter(f => f.priority === 'critical');
  const importantFindings = result.findings.filter(f => f.priority === 'important');

  const findingsList = result.findings
    .slice(0, 20)
    .map(f => `- [${f.priority.toUpperCase()}] ${f.title_en} (${f.module}, effort: ${f.effort}, impact: ${f.impact})\n  Issue: ${f.description_en}\n  Fix: ${f.recommendation_en}`)
    .join('\n\n');

  const pagesList = result.pages
    .slice(0, 10)
    .map(p => `- ${p.url}\n  Title: "${p.title || 'MISSING'}" (${p.titleLength ?? 0} chars)\n  Description: ${p.metaDescription ? `"${p.metaDescription.substring(0, 80)}..." (${p.metaDescriptionLength} chars)` : 'MISSING'}\n  H1: ${p.h1s[0] ? `"${p.h1s[0]}"` : 'MISSING'} ${p.h1s.length > 1 ? `(+${p.h1s.length - 1} more — problem!)` : ''}\n  Schema: ${p.schemaTypes.join(', ') || 'none'}\n  Words: ${p.wordCount}`)
    .join('\n\n');

  return `WEBSITE_AUDIT_REQUEST
URL: ${result.config.url}
Domain: ${result.domain}
Audited: ${result.auditedAt}
Pages crawled: ${result.crawlStats.crawledPages}
Overall Score: ${result.totalScore}/100
Critical findings: ${criticalFindings.length}
Important findings: ${importantFindings.length}

MODULE SCORES:
${result.moduleScores.map(m => `- ${m.label_en}: ${m.score}/100`).join('\n')}

TECHNICAL DATA:
- SSL: ${result.sslInfo ? `Grade ${result.sslInfo.grade || 'unknown'}, valid: ${result.sslInfo.valid}, expires in ${result.sslInfo.daysUntilExpiry ?? '?'} days` : 'not checked'}
- DNS SPF: ${result.dnsInfo?.hasSPF ?? 'not checked'} | DKIM: ${result.dnsInfo?.hasDKIM ?? 'not checked'} | DMARC: ${result.dnsInfo?.hasDMARC ?? 'not checked'}
- PageSpeed (mobile): ${result.pageSpeedData?.performanceScore ?? 'not checked'}/100
- LCP: ${result.pageSpeedData?.lcp ? Math.round(result.pageSpeedData.lcp / 100) / 10 + 's' : 'n/a'}
- CLS: ${result.pageSpeedData?.cls?.toFixed(3) ?? 'n/a'}
- Broken links: ${result.crawlStats.brokenLinks.length}
- Redirect chains: ${result.crawlStats.redirectChains.length}
- Safe Browsing: ${result.safeBrowsingData ? (result.safeBrowsingData.isSafe ? 'clean' : `THREATS: ${result.safeBrowsingData.threats?.join(', ')}`) : 'not checked'}

PAGES ANALYSED:
${pagesList}

FINDINGS (${result.findings.length} total):
${findingsList}

STRENGTHS:
${result.strengths_en.map(s => `- ${s}`).join('\n')}

---

Based on the above technical audit data, please:

1. Perform a deep CONTENT and UX analysis of ${result.config.url} — check for:
   - Contradictions in content (e.g. conflicting job titles, inconsistent product names)
   - Placeholder/unfinished content visible to users
   - Clarity and completeness of product/service offers
   - Quality and persuasiveness of CTAs
   - Trust signals (team, testimonials, logos, case studies)
   - Navigation usability and mobile experience
   - Tone, grammar, spelling

2. Add any findings I may have missed based on your analysis

3. Provide an executive summary (3-4 sentences) covering the site's strengths and most critical gaps

4. Give 3-5 specific, actionable content recommendations that would have the highest impact

5. Format your response as:

## Content & UX Deep Analysis

### Additional Findings
[list any new findings not in the automated audit]

### Executive Summary
[3-4 sentence summary]

### Top 5 High-Impact Content Recommendations
1. [specific recommendation]
2. ...

### What's Working Well
- [specific strength]
- ...

Please be concrete, not generic. Bad: "Improve the SEO." Good: "The meta title on /products is 78 characters — Google truncates at 60. Shorten to: 'Product Name | Brand'."`;
}
