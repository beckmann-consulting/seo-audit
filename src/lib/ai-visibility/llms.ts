// llms.txt for the AI visibility module: whether it is there and readable.
// Only ever a note (plan, check 3): no state of the file is a finding, and
// none counts for the score or the Top 5.
//
// Fetched like everything new of this module (Codex, review of bcfe8de):
// only the audited host and its www or apex counterpart, only public pinned
// addresses, redirects checked step by step, and only the first
// LLMS_MAX_BYTES of the body are read.

import { buildScope, safeFetch, DEFAULT_LIMITS, type Transport } from './safe-fetch';
import type { LlmsTxtInfo } from './types';

export const LLMS_MAX_BYTES = 200_000;

/** Classify an llms.txt response (pure; the fetch is below). */
export function classifyLlmsTxt(url: string, httpStatus: number, contentType: string | null, body: string): LlmsTxtInfo {
  if (httpStatus >= 500) return { status: 'error', url, httpStatus, reason: `HTTP ${httpStatus}` };
  if (httpStatus >= 400) return { status: 'absent', url, httpStatus };
  if (httpStatus < 200 || httpStatus >= 300) return { status: 'present-unreadable', url, httpStatus, reason: `HTTP ${httpStatus}` };
  const ct = (contentType || '').toLowerCase();
  const text = body.replace(/^﻿/, '').trimStart();
  if (/text\/html|application\/xhtml/.test(ct) || /^<(!doctype|html)/i.test(text)) {
    return { status: 'present-unreadable', url, httpStatus, reason: 'HTML instead of text (soft 404?)' };
  }
  if (!text) return { status: 'present-unreadable', url, httpStatus, reason: 'empty' };
  // llmstxt.org: the file starts with an H1, "# Name"
  if (!/^#\s+\S/.test(text)) return { status: 'present-unreadable', url, httpStatus, reason: 'does not start with a "# " heading' };
  return { status: 'present-readable', url, httpStatus };
}

export interface LlmsFetchOptions {
  auditHeaders?: Record<string, string>;
  transport?: Transport; // tests only
  timeoutMs?: number;
}

/** Fetch /llms.txt (and ask whether /llms-full.txt answers 200) of the audited site only. */
export async function fetchLlmsTxt(auditUrl: string, o: LlmsFetchOptions = {}): Promise<LlmsTxtInfo> {
  const origin = new URL(auditUrl).origin;
  const url = `${origin}/llms.txt`;
  const scope = await buildScope(auditUrl, o.transport);
  if (!scope.ok) return { status: 'error', url, reason: scope.reason };
  const limits = { ...DEFAULT_LIMITS, requestBytes: LLMS_MAX_BYTES, requestTimeoutMs: o.timeoutMs ?? 8000 };
  const budget = () => ({ bytesLeft: LLMS_MAX_BYTES + 1, deadline: Date.now() + (o.timeoutMs ?? 8000) * 2 });
  const r = await safeFetch(url, { method: 'GET', headers: { accept: 'text/plain, text/markdown, */*' } },
    { scope: scope.scope, transport: o.transport, limits, budget: budget(), document: true, auditHeaders: o.auditHeaders, truncate: true });
  if (!r.ok) return { status: 'error', url, reason: r.reason };
  const info = classifyLlmsTxt(url, r.res.status, r.res.headers['content-type'] ?? null, r.res.body.toString('utf8'));
  if (info.status === 'present-readable') {
    const full = await safeFetch(`${origin}/llms-full.txt`, { method: 'HEAD', headers: {} },
      { scope: scope.scope, transport: o.transport, limits, budget: budget(), document: true, auditHeaders: o.auditHeaders });
    info.hasFullTxt = full.ok && full.res.status >= 200 && full.res.status < 300;
  }
  return info;
}
