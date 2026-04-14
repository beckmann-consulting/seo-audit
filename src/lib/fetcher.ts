// Fetcht das HTML einer URL server-seitig (kein CORS-Problem)
// Gibt HTML-String + finale URL (nach Redirects) zurück

export interface FetchResult {
  html: string;
  finalUrl: string;
  statusCode: number;
  error?: string;
}

export async function fetchPageHtml(url: string): Promise<FetchResult> {
  // URL normalisieren
  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SEOAuditBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'de,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });

    const html = await response.text();

    return {
      html,
      finalUrl: response.url || normalizedUrl,
      statusCode: response.status,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      html: '',
      finalUrl: normalizedUrl,
      statusCode: 0,
      error: message,
    };
  }
}
