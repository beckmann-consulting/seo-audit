import { describe, expect, it } from 'vitest';
import { generateTechFindings } from './tech';
import type { CrawlStats } from '@/types';

const emptyStats = (): CrawlStats => ({
  totalPages: 1,
  crawledPages: 1,
  brokenLinks: [],
  redirectChains: [],
  externalLinks: 0,
  httpErrors: [],
  unreachable: [],
  renderFailed: [],
});

describe('split broken-link findings', () => {
  it('emits no broken-link findings when all three buckets are empty', () => {
    const findings = generateTechFindings([], emptyStats(), undefined, undefined);
    expect(findings.find(f => /broken|unreachable|JS-rendered|nicht erreichbar|defekte/i.test(f.title_en + f.title_de))).toBeUndefined();
  });

  it('emits the unreachable finding (important) when crawlStats.unreachable has entries', () => {
    const stats = { ...emptyStats(), unreachable: [{ url: 'https://x.com/dead', reason: 'getaddrinfo ENOTFOUND' }] };
    const findings = generateTechFindings([], stats, undefined, undefined);
    const f = findings.find(x => /unreachable/i.test(x.title_en));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('important');
    expect(f!.description_en).toContain('https://x.com/dead');
    expect(f!.description_en).toContain('ENOTFOUND');
  });

  it('emits the renderFailed finding (optional, gray) when crawlStats.renderFailed has entries', () => {
    const stats = { ...emptyStats(), renderFailed: [{ url: 'https://x.com/heavy', reason: 'Timeout 30000ms exceeded' }] };
    const findings = generateTechFindings([], stats, undefined, undefined);
    const f = findings.find(x => /JS-rendered/.test(x.title_en));
    expect(f).toBeDefined();
    expect(f!.priority).toBe('optional');
    expect(f!.title_en).toContain('reachable');
    expect(f!.description_en).toContain('Timeout 30000ms exceeded');
  });

  it('does NOT emit a renderFailed finding for unreachable URLs and vice versa', () => {
    const stats = { ...emptyStats(), unreachable: [{ url: 'https://x.com/dead', reason: 'timeout' }] };
    const findings = generateTechFindings([], stats, undefined, undefined);
    expect(findings.find(x => /JS-rendered/.test(x.title_en))).toBeUndefined();
  });

  it('keeps the existing 4xx + 5xx findings (httpErrors source)', () => {
    const stats: CrawlStats = {
      ...emptyStats(),
      httpErrors: [
        { url: 'https://x.com/four', status: 404 },
        { url: 'https://x.com/five', status: 500 },
      ],
    };
    const findings = generateTechFindings([], stats, undefined, undefined);
    expect(findings.find(f => /4xx/.test(f.title_en))).toBeDefined();
    expect(findings.find(f => /5xx/.test(f.title_en))).toBeDefined();
  });

  it('does NOT re-emit the legacy "N broken links" finding (replaced by the three buckets)', () => {
    const stats = { ...emptyStats(), brokenLinks: ['https://x.com/legacy'] };
    const findings = generateTechFindings([], stats, undefined, undefined);
    expect(findings.find(f => /\d+ broken links found/i.test(f.title_en))).toBeUndefined();
  });
});
