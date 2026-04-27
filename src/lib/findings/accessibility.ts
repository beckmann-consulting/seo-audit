// axe-core driven accessibility findings.
//
// axe-core runs in the headless browser (only when the audit was
// configured with rendering=js AND the accessibility module is on).
// Each violation we get back is per-page-per-rule. We cluster across
// pages so the audit emits one finding per axe rule with the affected
// URL count + a sample, instead of dozens of duplicates.
//
// Severity mapping (per spec):
//   axe.critical → Critical
//   axe.serious  → Important
//   axe.moderate → Recommended
//   axe.minor    → Optional
//
// When the user selected the accessibility module but the audit ran
// in static mode, we emit a single info-class finding explaining the
// gap so the empty result isn't confusing.

import type { AxeViolation, Finding, PageSEOData, Priority } from '@/types';
import { id } from './utils';

const SEVERITY_MAP: Record<NonNullable<AxeViolation['impact']>, Priority> = {
  critical: 'critical',
  serious: 'important',
  moderate: 'recommended',
  minor: 'optional',
};

interface Cluster {
  rule: AxeViolation;
  affectedUrls: string[];
  totalNodes: number;
}

// Pulls the WCAG-criterion tags from the axe tag list. Excludes
// category tags ("cat.color"), section tags ("section508"), etc.
// Keeps only "wcag*" entries (e.g. "wcag2aa", "wcag143", "wcag111").
function wcagTagsOnly(tags: string[]): string[] {
  return tags.filter(t => /^wcag/i.test(t));
}

export function generateAccessibilityFindings(pages: PageSEOData[], modulesIncluded: boolean): Finding[] {
  if (!modulesIncluded) return [];

  const pagesWithRun = pages.filter(p => p.axeViolations !== undefined);

  // Static mode (or otherwise no axe pass) → emit a guidance finding
  // so the user understands why the module produced no violations.
  if (pagesWithRun.length === 0) {
    return [{
      id: id(), priority: 'optional', module: 'accessibility', effort: 'low', impact: 'low',
      title_de: 'Accessibility-Audit nicht durchgeführt — JS-Mode erforderlich',
      title_en: 'Accessibility audit not run — JS mode required',
      description_de: 'Das Accessibility-Modul nutzt axe-core, das im Browser-Kontext laufen muss. Im aktuellen Static-Mode kann das nicht durchgeführt werden — keine Pflichten-Verstöße erkannt, aber auch keine Sicherheit dass die Seite WCAG-konform ist.',
      description_en: 'The accessibility module uses axe-core, which has to run inside a real browser. The current static mode can\'t do that — no violations were detected, but there\'s also no assurance the site is WCAG-compliant.',
      recommendation_de: 'Im Audit-Formular Rendering-Modus auf "JavaScript (Browserless / Chromium)" stellen und das Accessibility-Modul angehakt lassen. Dann werden alle Seiten gegen WCAG 2.1 AA geprüft.',
      recommendation_en: 'In the audit form, set rendering mode to "JavaScript (Browserless / Chromium)" and keep the Accessibility module checked. All pages will then be checked against WCAG 2.1 AA.',
    }];
  }

  // Cluster all violations by axe rule id so we don't emit one finding
  // per page-per-rule. The rule-level cluster is what users actually
  // act on ("fix the colour-contrast issue across the site").
  const clusters = new Map<string, Cluster>();
  for (const page of pagesWithRun) {
    for (const v of page.axeViolations ?? []) {
      let cluster = clusters.get(v.id);
      if (!cluster) {
        cluster = { rule: v, affectedUrls: [], totalNodes: 0 };
        clusters.set(v.id, cluster);
      }
      cluster.affectedUrls.push(page.url);
      cluster.totalNodes += v.nodes;
    }
  }
  if (clusters.size === 0) return [];

  const findings: Finding[] = [];
  for (const cluster of clusters.values()) {
    const priority: Priority = cluster.rule.impact
      ? SEVERITY_MAP[cluster.rule.impact]
      : 'recommended'; // axe occasionally returns null impact

    const urlSample = cluster.affectedUrls.slice(0, 5).join(', ');
    const more = cluster.affectedUrls.length > 5
      ? ` (+${cluster.affectedUrls.length - 5})`
      : '';
    const wcagTags = wcagTagsOnly(cluster.rule.tags);
    const wcagSuffix = wcagTags.length > 0 ? ` [${wcagTags.join(', ')}]` : '';

    findings.push({
      id: id(),
      priority,
      module: 'accessibility',
      effort: priority === 'critical' || priority === 'important' ? 'medium' : 'low',
      impact: priority === 'critical' ? 'high' : priority === 'important' ? 'medium' : 'low',
      title_de: `${cluster.rule.help} — ${cluster.totalNodes} Element(e) auf ${cluster.affectedUrls.length} Seite(n)${wcagSuffix}`,
      title_en: `${cluster.rule.help} — ${cluster.totalNodes} element(s) on ${cluster.affectedUrls.length} page(s)${wcagSuffix}`,
      description_de: `${cluster.rule.description} Betroffene Seiten: ${urlSample}${more}. Dokumentation: ${cluster.rule.helpUrl}`,
      description_en: `${cluster.rule.description} Affected pages: ${urlSample}${more}. Documentation: ${cluster.rule.helpUrl}`,
      recommendation_de: `Issue laut axe-Regel "${cluster.rule.id}" beheben. Detail-Anleitung mit Code-Beispielen: ${cluster.rule.helpUrl}`,
      recommendation_en: `Fix the violation per axe rule "${cluster.rule.id}". Detailed guidance with code examples: ${cluster.rule.helpUrl}`,
      affectedUrl: cluster.affectedUrls[0],
    });
  }

  // Sort: critical first, then by total node count desc — so the
  // worst clusters surface at the top of the findings list when the
  // PDF generator preserves ordering.
  const priorityRank: Record<Priority, number> = {
    critical: 0, important: 1, recommended: 2, optional: 3,
  };
  findings.sort((a, b) => {
    const pr = priorityRank[a.priority] - priorityRank[b.priority];
    if (pr !== 0) return pr;
    return 0;
  });

  return findings;
}
