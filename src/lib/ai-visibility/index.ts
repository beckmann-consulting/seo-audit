// The AI visibility module ("KI-Sichtbarkeit", ultimate-40): seven checks
// over what the audit already fetched (robots.txt, pages, sitemap) plus
// llms.txt of the same origin and, where Browserless did not render, an
// optional local render. Replaces aiReadiness without doubling it.

import { checkCrawlers } from './checks/crawlers';
import { checkSnippets } from './checks/snippets';
import { checkLlms } from './checks/llms';
import { checkStructured } from './checks/structured';
import { checkNoJs, type RenderedPage } from './checks/nojs';
import { checkAnswers } from './checks/answers';
import { checkTrust } from './checks/trust';
import { aiCoverage, aiModuleScore } from './score';
import { AI_CRAWLERS } from './crawlers';
import type { AIVisibilityInfo, LlmsTxtInfo, RobotsFetch } from './types';
import type { Finding, Module, PageData, PageSEOData, SitemapInfo } from '@/types';

export interface LocalRenderOutcome {
  renderedHtml?: string;
  incompleteReason?: string;
}

export interface AIVisibilityInput {
  pages: PageSEOData[];
  rawPages: PageData[]; // same order as pages
  robots: RobotsFetch;
  llms: LlmsTxtInfo;
  sitemap?: SitemapInfo;
  modules: Module[];
  imprintFound: boolean;
  localRender?: Map<string, LocalRenderOutcome>; // by page URL, only where Browserless did not render
}

export function evaluateAIVisibility(input: AIVisibilityInput): { info: AIVisibilityInfo; findings: Finding[] } {
  const { pages, rawPages, robots, llms, sitemap, modules } = input;
  const raw = (i: number): PageData | undefined => rawPages[i];
  const served = (i: number) => raw(i)?.staticHtml ?? raw(i)?.html ?? '';
  const current = (i: number) => raw(i)?.html ?? '';

  const c1 = checkCrawlers(robots, AI_CRAWLERS, modules);
  const c2 = checkSnippets(pages.map((p, i) => ({ url: p.url, html: served(i), xRobotsTag: raw(i)?.xRobotsTag })));
  const c3 = checkLlms(llms);
  const c6 = checkAnswers(pages.map((p, i) => ({ url: p.url, html: current(i), wordCount: p.wordCount })));
  const c4 = checkStructured({ pages, faqPages: c6.faqPages, modules });
  const rendered: RenderedPage[] = pages.map((p, i) => {
    const r = raw(i);
    if (r?.renderMode === 'js' && r.staticHtml !== undefined) {
      return { url: p.url, staticHtml: r.staticHtml, renderedHtml: r.html, source: 'browserless', seo: p };
    }
    const local = input.localRender?.get(p.url);
    if (local) return { url: p.url, staticHtml: served(i), renderedHtml: local.renderedHtml, source: 'local', incompleteReason: local.incompleteReason, seo: p };
    return { url: p.url, staticHtml: served(i), seo: p };
  });
  const c5 = checkNoJs(rendered, modules);
  const c7 = checkTrust({ pages: pages.map((p, i) => ({ url: p.url, html: current(i), seo: p, lastModified: raw(i)?.lastModified })), sitemap, modules, imprintFound: input.imprintFound });

  const checks = [c1.result, c2.result, c3.result, c4.result, c5.result, c6.result, c7.result];
  const findings = [...c1.findings, ...c2.findings, ...c4.findings, ...c5.findings, ...c6.findings, ...c7.findings];
  const info: AIVisibilityInfo = {
    checks,
    bots: c1.bots,
    robots: { status: robots.status, ...(robots.httpStatus !== undefined ? { httpStatus: robots.httpStatus } : {}) },
    llms,
    render: c5.render,
    coverage: aiCoverage(checks),
    score: aiModuleScore(checks, findings),
  };
  return { info, findings };
}

/** The sitemap is loaded for seo and, since ultimate-40, for ai alone too (check 7 compares lastmod). */
export function needsSitemap(modules: Module[]): boolean {
  return modules.includes('seo') || modules.includes('ai');
}

export { fetchLlmsTxt } from './llms';
export { weightedTotal } from './score';
