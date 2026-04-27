// HTTP Basic Auth header construction and credential sanitisation
// for the audit pipeline.
//
// Credentials enter via AuditConfig.basicAuth and need to reach every
// fetcher (crawler, robots.txt probe, sitemap, security headers, etc.)
// without ever leaving the server. The sanitiser is the second half:
// before the AuditResult round-trips to the client (and from there into
// localStorage / PDF / cached audits), we strip credential-bearing
// fields from the embedded config copy.

import type { AuditConfig } from '@/types';

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

export function buildBasicAuthHeader(creds: BasicAuthCredentials | undefined): string | undefined {
  if (!creds) return undefined;
  const { username, password } = creds;
  if (!username && !password) return undefined;
  // RFC 7617: base64(username:password). The colon is part of the
  // encoded value; we don't validate that the username has no colons
  // because some servers (rarely) accept that form.
  const encoded = btoa(`${username}:${password}`);
  return `Basic ${encoded}`;
}

// Returns a copy of the config safe to embed in AuditResult.config.
// We drop basicAuth entirely (no half-masked passwords) and mask the
// API key with a fixed token so consumers can tell "a key was used"
// without seeing the value.
export function sanitizeConfigForClient(config: AuditConfig): AuditConfig {
  const clone: AuditConfig = { ...config };
  if (clone.basicAuth) {
    delete clone.basicAuth;
  }
  if (clone.googleApiKey) {
    clone.googleApiKey = '***';
  }
  return clone;
}
