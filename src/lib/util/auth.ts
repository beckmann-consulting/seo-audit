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

// Headers whose values we always mask before round-trip to the client.
// Match is case-insensitive. The X-Auth- prefix catches the broad
// family of bespoke bearer-token / signed-request headers (X-Auth-Token,
// X-Auth-User, X-Auth-Signature, …).
const SENSITIVE_HEADER_NAMES = new Set([
  'cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
]);
const SENSITIVE_HEADER_PREFIX = 'x-auth-';

export function isSensitiveHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(lower)) return true;
  if (lower.startsWith(SENSITIVE_HEADER_PREFIX)) return true;
  return false;
}

// Returns a copy of the config safe to embed in AuditResult.config.
// We drop basicAuth entirely (no half-masked passwords), mask the
// API key with a fixed token, and mask the value of any sensitive
// custom header — leaving benign headers (Accept-Language, custom
// debug headers) visible so users can verify their config round-tripped.
export function sanitizeConfigForClient(config: AuditConfig): AuditConfig {
  const clone: AuditConfig = { ...config };
  if (clone.basicAuth) {
    delete clone.basicAuth;
  }
  if (clone.googleApiKey) {
    clone.googleApiKey = '***';
  }
  if (clone.customHeaders) {
    const masked: Record<string, string> = {};
    for (const [name, value] of Object.entries(clone.customHeaders)) {
      masked[name] = isSensitiveHeader(name) ? '***' : value;
    }
    clone.customHeaders = masked;
  }
  return clone;
}
