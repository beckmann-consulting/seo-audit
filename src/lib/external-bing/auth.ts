// Bing Webmaster Tools auth — currently a single env-stored API key.
//
// Encapsulated as a function (not just a direct process.env read) so
// a future OAuth-based flow can land without touching call sites.
// The orchestrator and route helper only need "give me the credential
// to talk to Bing"; how that credential is obtained stays here.
//
// No discriminated union like GSC's GscAuth — Bing has exactly one
// auth model today and the trade-off vs adding indirection isn't
// worth it. If Microsoft ships an OAuth flow later, introduce the DU
// at that point.

const ENV_KEY = 'BING_WMT_API_KEY';

// Returns the configured API key, or null when the env var is unset
// or empty. The route handler distinguishes null from a non-empty
// string to drive the BingResult.state = 'disabled' branch.
export function getBingApiKey(): string | null {
  const raw = process.env[ENV_KEY];
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class BingAuthError extends Error {
  constructor(message: string, public readonly userError = false) {
    super(message);
    this.name = 'BingAuthError';
  }
}
