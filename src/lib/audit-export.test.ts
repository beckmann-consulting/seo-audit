import { describe, it, expect } from 'vitest';
import {
  buildJsonExport,
  serialiseJsonExport,
  parseJsonExport,
  exportFilename,
  EXPORT_SCHEMA_VERSION,
  ExportParseError,
} from './audit-export';
import type { AuditResult } from '@/types';

// Minimal valid AuditResult — just enough to satisfy isValidAuditResult.
function makeResult(overrides: Partial<AuditResult> = {}): AuditResult {
  return {
    config: {
      url: 'https://example.com/',
      modules: ['seo'],
      author: 'tester',
      maxPages: 0,
    },
    auditedAt: '2026-04-27T10:00:00.000Z',
    domain: 'example.com',
    totalScore: 75,
    moduleScores: [],
    findings: [],
    strengths_de: [],
    strengths_en: [],
    crawlStats: {
      totalPages: 1, crawledPages: 1, brokenLinks: [], redirectChains: [],
      externalLinks: 0, errorPages: [],
    },
    pages: [],
    topFindings: [],
    claudePrompt: '',
    summary_de: '',
    summary_en: '',
    ...overrides,
  };
}

describe('buildJsonExport', () => {
  it('wraps the audit in an envelope with schemaVersion / exportedAt / generator', () => {
    const env = buildJsonExport(makeResult());
    expect(env.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(env.generator).toBe('seo-audit-pro');
    expect(env.audit).toBeDefined();
    expect(typeof env.exportedAt).toBe('string');
    expect(() => new Date(env.exportedAt)).not.toThrow();
  });

  it('strips basicAuth from the embedded config (defence in depth)', () => {
    const env = buildJsonExport(makeResult({
      config: {
        url: 'https://example.com/',
        modules: ['seo'],
        author: 'tester',
        maxPages: 0,
        basicAuth: { username: 'admin', password: 'secret' },
      },
    }));
    expect(env.audit.config.basicAuth).toBeUndefined();
  });

  it('masks googleApiKey in the embedded config', () => {
    const env = buildJsonExport(makeResult({
      config: {
        url: 'https://example.com/',
        modules: ['seo'],
        author: 'tester',
        maxPages: 0,
        googleApiKey: 'AIzaXXX',
      },
    }));
    expect(env.audit.config.googleApiKey).toBe('***');
  });

  it('does not mutate the input result', () => {
    const result = makeResult({
      config: {
        url: 'https://example.com/',
        modules: ['seo'],
        author: 'tester',
        maxPages: 0,
        basicAuth: { username: 'a', password: 'b' },
      },
    });
    buildJsonExport(result);
    expect(result.config.basicAuth).toEqual({ username: 'a', password: 'b' });
  });
});

describe('serialiseJsonExport + parseJsonExport (round-trip)', () => {
  it('serialises to valid JSON and parses back to the same audit shape', () => {
    const original = makeResult({ totalScore: 88, domain: 'foo.example' });
    const serialised = serialiseJsonExport(original);
    const reparsed = parseJsonExport(serialised);
    expect(reparsed.totalScore).toBe(88);
    expect(reparsed.domain).toBe('foo.example');
  });

  it('produces pretty-printed JSON (2-space indent) for human inspection', () => {
    const serialised = serialiseJsonExport(makeResult());
    expect(serialised).toMatch(/\n  "schemaVersion"/);
  });
});

describe('parseJsonExport — error cases', () => {
  it('throws on malformed JSON', () => {
    expect(() => parseJsonExport('{not-json')).toThrowError(ExportParseError);
  });

  it('throws on a top-level non-object value', () => {
    expect(() => parseJsonExport('"a string"')).toThrowError(/object/i);
  });

  it('throws on missing schemaVersion', () => {
    const env = JSON.stringify({ exportedAt: '2026-01-01', audit: {} });
    expect(() => parseJsonExport(env)).toThrowError(/schemaVersion/);
  });

  it('throws on incompatible major schemaVersion', () => {
    const env = JSON.stringify({
      schemaVersion: '2.0',
      exportedAt: '2026-01-01',
      generator: 'seo-audit-pro',
      audit: makeResult(),
    });
    expect(() => parseJsonExport(env)).toThrowError(/Unsupported schemaVersion/);
  });

  it('accepts compatible minor-version bumps (1.x)', () => {
    const env = JSON.stringify({
      schemaVersion: '1.5',
      exportedAt: '2026-01-01',
      generator: 'seo-audit-pro',
      audit: makeResult(),
    });
    expect(() => parseJsonExport(env)).not.toThrow();
  });

  it('throws on audit envelope that fails shape validation', () => {
    const env = JSON.stringify({
      schemaVersion: '1.0',
      exportedAt: '2026-01-01',
      generator: 'seo-audit-pro',
      audit: { not: 'an audit' },
    });
    expect(() => parseJsonExport(env)).toThrowError(/shape/);
  });
});

describe('exportFilename', () => {
  it('uses the audit domain and audited date', () => {
    const result = makeResult({ domain: 'example.com', auditedAt: '2026-04-27T10:00:00.000Z' });
    expect(exportFilename(result)).toBe('example.com-audit-2026-04-27.json');
  });
});
