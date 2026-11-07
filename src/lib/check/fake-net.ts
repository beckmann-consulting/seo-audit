// Test network for the free check (tests only): names resolve from a table,
// requests are answered from a table, and every request that is still open
// is counted. A hanging answer ends only when the run's signal aborts, like
// abortableTransport does.

import { Readable } from 'node:stream';
import type { Address, RawResponse, RequestInit, Transport } from '@/lib/ai-visibility/safe-fetch';

export interface FakeAnswer {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  hang?: boolean;
}

export class FakeNet {
  open = 0;
  requested: string[] = [];
  constructor(
    private readonly names: Record<string, string[]>,
    private readonly answers: (url: URL) => FakeAnswer,
  ) {}

  transport(signal: AbortSignal): Transport {
    return {
      resolve: async (host: string): Promise<Address[]> => {
        const a = this.names[host];
        if (!a) throw new Error(`${host} does not resolve`);
        return a.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
      },
      request: (url: URL, address: Address, init: RequestInit): Promise<RawResponse> => {
        this.requested.push(`${url.href} @${address.address}`);
        const a = this.answers(url);
        this.open++;
        return new Promise((resolve, reject) => {
          const done = () => { this.open--; };
          if (a.hang) {
            const onAbort = () => { done(); reject(new Error('aborted')); };
            if (signal.aborted) onAbort();
            else signal.addEventListener('abort', onAbort, { once: true });
            return;
          }
          const body = Readable.from([Buffer.from(a.body ?? '')]);
          body.on('close', done);
          resolve({ status: a.status, headers: { 'content-type': 'text/html; charset=utf-8', ...(a.headers ?? {}) }, body });
          void init;
        });
      },
    };
  }
}

export const HOME_HTML = `<!doctype html><html lang="de"><head><title>Beispiel Praxis in Musterstadt</title>
<meta name="description" content="Praxis in Musterstadt: Termine, Leistungen und Kontakt.">
<link rel="canonical" href="https://beispiel.example/"></head>
<body><h1>Beispiel Praxis</h1><p>${'Text '.repeat(200)}</p>
<a href="/impressum">Impressum</a> <a href="/datenschutz">Datenschutz</a></body></html>`;
