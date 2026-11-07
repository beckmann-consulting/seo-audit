// A request body read with a hard limit (websites-27, Codex review of
// 6ea683b): the public routes read at most maxBytes, whether the client sends
// Content-Length or a chunked body, and stop a body that arrives too slowly.
// Nothing is buffered beyond the limit.

export type BodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 408 | 413 };

export async function readJsonLimited(req: Request, maxBytes: number, timeoutMs = 5000): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!req.body) return { ok: false, status: 400 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel();
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: timedOut ? 408 : 400 };
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) return { ok: false, status: 408 };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400 };
  }
}
