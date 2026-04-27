// Versioned JSON export for an AuditResult.
//
// Wraps the result in a metadata envelope so future format
// changes can be detected on import:
//   { schemaVersion, exportedAt, generator, audit: AuditResult }
//
// We re-run sanitizeConfigForClient before serialisation as a
// defence-in-depth measure: the route layer already strips
// credentials before the result reaches the browser, but a fresh
// pass here guarantees that whatever the user just downloaded
// can be safely shared, archived, or re-imported.

import type { AuditResult } from '@/types';
import { sanitizeConfigForClient } from './util/auth';
import { isValidAuditResult } from './audit-diff';

export const EXPORT_SCHEMA_VERSION = '1.0';
export const EXPORT_GENERATOR = 'seo-audit-pro';

export interface AuditExportEnvelope {
  schemaVersion: string;
  exportedAt: string; // ISO 8601
  generator: string;
  audit: AuditResult;
}

export function buildJsonExport(result: AuditResult): AuditExportEnvelope {
  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: EXPORT_GENERATOR,
    audit: {
      ...result,
      // Defensive: even though the route already sanitises, run again
      // so the file we hand to the user / cache / share is guaranteed
      // credential-free regardless of upstream changes.
      config: sanitizeConfigForClient(result.config),
    },
  };
}

export function serialiseJsonExport(result: AuditResult): string {
  return JSON.stringify(buildJsonExport(result), null, 2);
}

export class ExportParseError extends Error {
  constructor(message: string, public readonly cause?: string) {
    super(message);
    this.name = 'ExportParseError';
  }
}

// Parses an export file produced by buildJsonExport. Returns the
// inner AuditResult on success; throws ExportParseError with a
// human-readable message on schema-version mismatch or shape errors.
export function parseJsonExport(text: string): AuditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ExportParseError(
      'File is not valid JSON',
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ExportParseError('Top-level JSON value is not an object');
  }
  const env = parsed as Partial<AuditExportEnvelope>;
  if (typeof env.schemaVersion !== 'string') {
    throw new ExportParseError('Missing schemaVersion — not an audit export file');
  }
  // Major-version compatibility: accept 1.x, reject 2.x and beyond
  // until we explicitly add a migration path.
  const major = env.schemaVersion.split('.')[0];
  const supportedMajor = EXPORT_SCHEMA_VERSION.split('.')[0];
  if (major !== supportedMajor) {
    throw new ExportParseError(
      `Unsupported schemaVersion "${env.schemaVersion}" (this build understands ${supportedMajor}.x)`,
    );
  }
  if (!isValidAuditResult(env.audit)) {
    throw new ExportParseError('Envelope.audit failed shape validation');
  }
  return env.audit;
}

// Filename helper used by the browser download trigger and any
// future server-side endpoint. Keeps the convention identical to
// the existing PDF export filename.
export function exportFilename(result: AuditResult): string {
  const date = new Date(result.auditedAt).toISOString().slice(0, 10);
  return `${result.domain}-audit-${date}.json`;
}
