import { describe, expect, it } from 'vitest';
import { readJsonLimited } from './body';

function chunked(parts: string[], delayMs = 0): Request {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      for (const p of parts) {
        if (delayMs) await new Promise(r => setTimeout(r, delayMs));
        c.enqueue(enc.encode(p));
      }
      c.close();
    },
  });
  return new Request('http://x/', { method: 'POST', body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
}

describe('readJsonLimited', () => {
  it('reads a small JSON body', async () => {
    expect(await readJsonLimited(new Request('http://x/', { method: 'POST', body: '{"domain":"a.example"}' }), 2048)).toEqual({ ok: true, value: { domain: 'a.example' } });
  });

  it('answers 413 by Content-Length before reading', async () => {
    const r = new Request('http://x/', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': '999999' } });
    expect(await readJsonLimited(r, 2048)).toEqual({ ok: false, status: 413 });
  });

  it('answers 413 for a chunked body without Content-Length once it passes the limit', async () => {
    expect(await readJsonLimited(chunked(['{"a":"', 'x'.repeat(1500), 'x'.repeat(1500), '"}']), 2048)).toEqual({ ok: false, status: 413 });
  });

  it('answers 408 for a body that arrives too slowly', async () => {
    expect(await readJsonLimited(chunked(['{"a":', '1}'], 200), 2048, 100)).toEqual({ ok: false, status: 408 });
  });

  it('answers 400 for invalid JSON', async () => {
    expect(await readJsonLimited(new Request('http://x/', { method: 'POST', body: 'nope' }), 2048)).toEqual({ ok: false, status: 400 });
  });
});
