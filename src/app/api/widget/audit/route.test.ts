import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const post = (body: string, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/widget/audit', { method: 'POST', body, headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 250)}`, ...headers } }));

describe('POST /api/widget/audit: input (websites-27)', () => {
  it('refuses IP literals, ports and credentials before any fetch', async () => {
    for (const url of ['http://127.0.0.1/', '169.254.169.254', 'https://[::1]/', 'https://example.com:8080/', 'https://user:pw@example.com/', 'localhost']) {
      const r = await post(JSON.stringify({ url }));
      expect(r.status, url).toBe(400);
    }
  });

  it('answers 413 for a body over 4 KB', async () => {
    const r = await post(JSON.stringify({ url: 'example.com', pad: 'x'.repeat(5000) }));
    expect(r.status).toBe(413);
  });
});
