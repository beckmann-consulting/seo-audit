// POST /api/widget/check: the free check of beckmanndigital.com (websites-27).
// Public through the existing /api/widget/* matcher of the Caddyfile; the
// work, the limits and the cache live in src/lib/check/service.ts.

import { NextRequest, NextResponse } from 'next/server';
import { readJsonLimited } from '@/lib/check/body';
import { checkCorsHeaders, clientAddressFrom, createCheckService, SWEEP_EVERY_MS } from '@/lib/check/service';

export const maxDuration = 70;
export const dynamic = 'force-dynamic';

const service = createCheckService({ pageSpeedKey: process.env.GOOGLE_API_KEY || undefined });
// expired cache and address entries are deleted, not only on access
setInterval(() => service.sweep(), SWEEP_EVERY_MS).unref();

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: checkCorsHeaders(req.headers.get('origin')) });
}

export async function POST(req: NextRequest) {
  const headers = checkCorsHeaders(req.headers.get('origin'));
  // at most 2 KB, read before anything else happens (a domain and a language fit in far less)
  const read = await readJsonLimited(req, 2048);
  if (!read.ok) return NextResponse.json({ ok: false, error: read.status === 413 ? 'too_large' : read.status === 408 ? 'too_slow' : 'invalid_domain' }, { status: read.status, headers });
  const body = (read.value ?? {}) as { domain?: unknown; lang?: unknown };
  const r = await service.handle({ domain: body.domain, lang: body.lang, clientAddress: clientAddressFrom(req.headers) });
  return NextResponse.json(r.body, { status: r.status, headers });
}
