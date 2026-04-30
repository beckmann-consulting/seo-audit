'use client';

import { useState, useEffect, useRef } from 'react';
import type { AuditResult, AuditDiff, Finding, Module, AuditConfig, Lang, UserAgentPreset, StreamEvent } from '@/types';
import { computeDiff, isValidAuditResult } from '@/lib/audit-diff';
import { TITLE_LIMIT_MOBILE_PX, META_DESC_LIMIT_PX } from '@/lib/util/pixel-width';
import { formatDate } from '@/lib/util/format';
import { StatusBanner } from './StatusBanner';
import { GscRowsTable } from './GscRowsTable';
import { getVisibleGscWarnings } from './gsc-warnings';
import { checkPatterns, type PatternError } from './audit-form-validation';

const USER_AGENT_OPTIONS: { value: UserAgentPreset; label: string }[] = [
  { value: 'default', label: 'SEO Audit Pro (Default)' },
  { value: 'googlebot-mobile', label: 'Googlebot Mobile' },
  { value: 'googlebot-desktop', label: 'Googlebot Desktop' },
  { value: 'bingbot', label: 'Bingbot' },
  { value: 'gptbot', label: 'GPTBot (OpenAI)' },
  { value: 'claudebot', label: 'ClaudeBot (Anthropic)' },
  { value: 'perplexitybot', label: 'PerplexityBot' },
  { value: 'custom', label: 'Custom…' },
];

// ============================================================
//  LocalStorage cache — one AuditResult per hostname.
// ============================================================
interface CachedAudit {
  result: AuditResult;
  cachedAt: string; // ISO
}

function cacheKey(hostname: string): string {
  return `seo_audit_cache_${hostname}`;
}

function loadCachedAudit(hostname: string): CachedAudit | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(hostname));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const c = parsed as Record<string, unknown>;
    if (typeof c.cachedAt !== 'string' || !isValidAuditResult(c.result)) return null;
    return { result: c.result, cachedAt: c.cachedAt };
  } catch {
    return null;
  }
}

function saveCachedAudit(hostname: string, result: AuditResult): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: CachedAudit = { result, cachedAt: new Date().toISOString() };
    window.localStorage.setItem(cacheKey(hostname), JSON.stringify(payload));
  } catch {
    // Quota exceeded or private mode — ignore silently
  }
}

function hostnameOf(urlOrHost: string): string | null {
  try {
    return new URL(urlOrHost).hostname;
  } catch {
    return null;
  }
}

const ALL_MODULES: { id: Module; label_de: string; label_en: string; desc_de: string; desc_en: string }[] = [
  { id: 'seo', label_de: 'SEO', label_en: 'SEO', desc_de: 'Meta-Tags, Sitemap, Schema, Canonical', desc_en: 'Meta tags, sitemap, schema, canonical' },
  { id: 'content', label_de: 'Inhalte', label_en: 'Content', desc_de: 'H1, Alt-Texte, Wortanzahl, Headings', desc_en: 'H1, alt texts, word count, headings' },
  { id: 'legal', label_de: 'Rechtliches', label_en: 'Legal', desc_de: 'Impressum, DSGVO, Cookie-Banner', desc_en: 'Imprint, GDPR, cookie consent' },
  { id: 'ux', label_de: 'UX & Struktur', label_en: 'UX & Structure', desc_de: 'Navigation, CTAs, Verlinkung', desc_en: 'Navigation, CTAs, linking' },
  { id: 'tech', label_de: 'Technik', label_en: 'Tech', desc_de: 'SSL, DNS, defekte Links, Bildformate', desc_en: 'SSL, DNS, broken links, image formats' },
  { id: 'performance', label_de: 'Performance', label_en: 'Performance', desc_de: 'PageSpeed, Core Web Vitals (braucht Google API Key)', desc_en: 'PageSpeed, Core Web Vitals (needs Google API key)' },
  { id: 'accessibility', label_de: 'Barrierefreiheit', label_en: 'Accessibility', desc_de: 'WCAG 2.1 AA via axe-core (braucht JS-Mode)', desc_en: 'WCAG 2.1 AA via axe-core (requires JS mode)' },
  { id: 'offers', label_de: 'Angebote', label_en: 'Offers', desc_de: 'CTAs, Produktseiten — nur im Claude-Prompt, kein Auto-Check', desc_en: 'CTAs, product pages — Claude prompt only, no auto-check' },
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'var(--fail)',
  important: 'var(--warn)',
  recommended: 'var(--info)',
  optional: 'var(--text-strong)',
};

const PRIORITY_BG: Record<string, string> = {
  critical: 'var(--fail-bg)',
  important: 'var(--warn-bg)',
  recommended: 'var(--info-bg)',
  optional: 'var(--border-soft)',
};

function scoreColor(s: number) {
  if (s >= 75) return 'var(--pass)';
  if (s >= 50) return 'var(--warn)';
  return 'var(--fail)';
}

function scoreBg(s: number) {
  if (s >= 75) return 'var(--pass-bg)';
  if (s >= 50) return 'var(--warn-bg)';
  return 'var(--fail-bg)';
}

export default function AuditApp() {
  const [lang, setLang] = useState<Lang>('de');
  const [url, setUrl] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [hasEnvGoogleKey, setHasEnvGoogleKey] = useState(false);
  const [modules, setModules] = useState<Module[]>(
    // accessibility off by default — adds 1-2s per page when JS-mode
    // is enabled, and is meaningless without it.
    ALL_MODULES.map(m => m.id).filter(m => m !== 'offers' && m !== 'accessibility'),
  );
  const [userAgent, setUserAgent] = useState<UserAgentPreset>('default');
  const [customUserAgent, setCustomUserAgent] = useState('');
  const [includePatterns, setIncludePatterns] = useState('');
  const [excludePatterns, setExcludePatterns] = useState('');
  const [basicAuthUser, setBasicAuthUser] = useState('');
  const [basicAuthPass, setBasicAuthPass] = useState('');
  const [customHeadersText, setCustomHeadersText] = useState('');
  const [csvTable, setCsvTable] = useState<'findings' | 'pages' | 'broken-links' | 'error-pages' | 'sitemap-urls' | 'redirects'>('findings');
  const [imageProbeLimit, setImageProbeLimit] = useState(20);
  const [mobileDesktopParity, setMobileDesktopParity] = useState(false);
  const [rendering, setRendering] = useState<'static' | 'js' | 'auto'>('auto');
  const [includeScreenshots, setIncludeScreenshots] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState('');
  // Mid-stream warnings (non-fatal). Type-derived from StreamEvent
  // via Extract so adding new SSE-warning fields doesn't require a
  // second declaration here.
  const [warnings, setWarnings] = useState<Extract<StreamEvent, { type: 'warning' }>[]>([]);
  const [activeTab, setActiveTab] = useState<'findings' | 'pages' | 'tech' | 'gsc' | 'prompt'>('findings');
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set());
  const [showConfig, setShowConfig] = useState(true);
  const [copied, setCopied] = useState(false);
  // Disclosure state for the "Erweiterte Optionen" section. SSR-safe
  // initial value is false; the post-mount effect rehydrates from
  // localStorage. One-frame flicker on mount is acceptable trade for
  // not faking a hydration boundary. Persisted across sessions —
  // power-user setting, not audit-specific.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Inline regex error for include/exclude patterns. Live-validated:
  // every keystroke in either textarea re-runs checkPatterns over both
  // values, so the inline message + red border reflect the current
  // truth without waiting for a re-submit.
  const [patternError, setPatternError] = useState<PatternError | null>(null);
  // progressInterval previously held a fake setInterval; progress now
  // comes from an SSE-style stream so the ref is no longer needed.

  // Diff / comparison state
  const [cachedPrevious, setCachedPrevious] = useState<CachedAudit | null>(null);
  const [diff, setDiff] = useState<AuditDiff | null>(null);
  const [diffError, setDiffError] = useState('');
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  // Scroll target for the auto-expand-on-invalid-regex flow.
  const includeExcludeRef = useRef<HTMLDivElement | null>(null);
  // Refs for the disclosure focus-management on close — when the
  // panel hides, browsers drop focus to body; we put it back on the
  // toggle so keyboard users don't get stranded.
  const advancedToggleRef = useRef<HTMLButtonElement | null>(null);
  const advancedPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d.hasGoogleKey) setHasEnvGoogleKey(true);
    }).catch(() => {});
  }, []);

  // Rehydrate the disclosure state from localStorage on mount. Plain
  // try/catch covers QuotaExceeded, disabled storage, and the SSR
  // hop where window is undefined.
  useEffect(() => {
    try {
      if (window.localStorage.getItem('seo_audit_form_advanced_open') === 'true') {
        setAdvancedOpen(true);
      }
    } catch {}
  }, []);

  // Persist toggle changes (and auto-expand events from validation)
  // back to localStorage. Auto-expand persists too — if a user is
  // routinely tripping pattern validation, leaving advanced open by
  // default next session is the right outcome.
  useEffect(() => {
    try {
      window.localStorage.setItem('seo_audit_form_advanced_open', String(advancedOpen));
    } catch {}
  }, [advancedOpen]);

  const isDE = lang === 'de';
  const t = (de: string, en: string) => isDE ? de : en;

  // Server step keys → human label (DE/EN). Keys match the progress
  // events emitted by POST /api/audit.
  const STEP_LABELS: Record<string, { de: string; en: string }> = {
    dns_check: { de: 'DNS wird geprüft…', en: 'Checking DNS…' },
    ssl_check: { de: 'SSL-Zertifikat wird geprüft…', en: 'Checking SSL certificate…' },
    robots_fetch: { de: 'robots.txt wird geladen…', en: 'Fetching robots.txt…' },
    sitemap_fetch: { de: 'Sitemap wird geparst…', en: 'Parsing sitemap…' },
    crawl_start: { de: 'Crawl startet…', en: 'Starting crawl…' },
    crawl_progress: { de: 'Seiten werden gecrawlt…', en: 'Crawling pages…' },
    pagespeed_check: { de: 'PageSpeed wird geprüft…', en: 'Checking PageSpeed…' },
    security_headers: { de: 'Security Headers werden geprüft…', en: 'Checking security headers…' },
    ai_crawler_check: { de: 'AI-Crawler-Readiness wird geprüft…', en: 'Checking AI crawler readiness…' },
    findings_generation: { de: 'Findings werden generiert…', en: 'Generating findings…' },
    complete: { de: 'Fertig!', en: 'Done!' },
  };

  // StreamEvent comes from @/types — single source of truth shared
  // with the route handler.

  function applyStreamEvent(ev: StreamEvent) {
    if (ev.type === 'progress') {
      setProgress(ev.percent);
      const label = STEP_LABELS[ev.step];
      if (label) setProgressText(isDE ? label.de : label.en);
      else setProgressText(ev.step);
      setProgressDetail(ev.detail || '');
    } else if (ev.type === 'warning') {
      // Non-fatal mid-stream notice (e.g. GSC API blip). Collected
      // into typed state so G1d's Search Console tab can render
      // them; until then they live in state without UI rendering.
      setWarnings(w => [...w, ev]);
    } else if (ev.type === 'result') {
      setResult(ev.payload);
      setActiveTab('findings');
      setProgress(100);
      setProgressText(t('Fertig!', 'Done!'));
      // Cache the new result and surface any older cached audit for diffing.
      // Only show the compare button if the cached audit is at least 1h old —
      // caches from the same session shouldn't invite a self-comparison.
      const host = hostnameOf(ev.payload.config.url) ?? ev.payload.domain;
      const existing = loadCachedAudit(host);
      if (existing) {
        const ageMs = Date.now() - Date.parse(existing.cachedAt);
        if (!Number.isNaN(ageMs) && ageMs > 60 * 60 * 1000) {
          setCachedPrevious(existing);
        } else {
          setCachedPrevious(null);
        }
      } else {
        setCachedPrevious(null);
      }
      saveCachedAudit(host, ev.payload);
      setDiff(null);
      setDiffError('');
    } else if (ev.type === 'error') {
      setError(ev.message);
      setShowConfig(true);
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(isDE ? 'de-DE' : 'en-GB', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  function openDiffWithCached() {
    if (!result || !cachedPrevious) return;
    setDiff(computeDiff(result, cachedPrevious.result, cachedPrevious.cachedAt));
    setDiffError('');
  }

  function handleUploadClick() {
    uploadInputRef.current?.click();
  }

  async function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !result) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!isValidAuditResult(parsed)) {
        setDiffError(t('Ungültige Audit-Datei', 'Invalid audit file'));
        return;
      }
      const previousDate = parsed.auditedAt;
      setDiff(computeDiff(result, parsed, previousDate));
      setDiffError('');
    } catch (err) {
      setDiffError(`${t('Upload fehlgeschlagen', 'Upload failed')}: ${String(err)}`);
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = '';
    }
  }

  function closeDiff() {
    setDiff(null);
  }

  async function runAudit() {
    if (!url.trim()) return;

    // Pre-flight regex validation for the crawler include/exclude
    // patterns. Live validation in onChange already keeps patternError
    // up to date — this is the submit-time guard that auto-expands the
    // disclosure and scrolls to the offending row instead of letting
    // the audit kick off and fail server-side with a 400. setError is
    // intentionally NOT set: the inline message is the surfaced error,
    // top-level setError is reserved for non-form failures.
    const submitTimeError = checkPatterns(includePatterns, excludePatterns);
    if (submitTimeError) {
      setPatternError(submitTimeError);
      setAdvancedOpen(true);
      // requestAnimationFrame ensures the disclosure body has been
      // rendered before we scroll — the ref is null until then.
      requestAnimationFrame(() => {
        includeExcludeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    setWarnings([]); // ephemeral per audit run — do not persist across audits
    setShowConfig(false);
    setProgress(2);
    setProgressText(t('Audit startet…', 'Starting audit…'));
    setProgressDetail('');

    const splitLines = (s: string): string[] | undefined => {
      const lines = s.split('\n').map(l => l.trim()).filter(Boolean);
      return lines.length > 0 ? lines : undefined;
    };

    // Parse "Header-Name: value" lines into a Record. Lines without
    // a colon are silently dropped (the UI placeholder explains the
    // expected format). Only lines with both a name and value count.
    const parseHeaders = (s: string): Record<string, string> | undefined => {
      const out: Record<string, string> = {};
      for (const raw of s.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const colonIdx = line.indexOf(':');
        if (colonIdx <= 0) continue;
        const name = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (!name || !value) continue;
        out[name] = value;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    };

    const config: AuditConfig = {
      url: url.trim(),
      googleApiKey: googleKey.trim() || undefined,
      modules,
      author: 'TW Beckmann Consultancy Services',
      maxPages: 0,
      userAgent,
      customUserAgent: userAgent === 'custom' ? customUserAgent.trim() || undefined : undefined,
      include: splitLines(includePatterns),
      exclude: splitLines(excludePatterns),
      basicAuth: basicAuthUser && basicAuthPass
        ? { username: basicAuthUser, password: basicAuthPass }
        : undefined,
      customHeaders: parseHeaders(customHeadersText),
      imageHeadCheckLimit: Number.isFinite(imageProbeLimit) ? Math.max(0, imageProbeLimit) : 20,
      mobileDesktopParityCheck: mobileDesktopParity,
      rendering,
      includeScreenshots: rendering === 'js' ? includeScreenshots : undefined,
    };

    try {
      const resp = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      // Validation / JSON error path — non-stream response
      if (!resp.ok && !(resp.headers.get('content-type') || '').includes('text/event-stream')) {
        const data = await resp.json().catch(() => ({ error: 'Unknown error' }));
        setError(data.error || 'Unknown error');
        setShowConfig(true);
        setLoading(false);
        return;
      }

      if (!resp.body) {
        setError(t('Kein Response-Body erhalten', 'No response body received'));
        setShowConfig(true);
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let sawResult = false;
      let sawError = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line (\n\n)
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const chunk = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLine = chunk.split('\n').find(line => line.startsWith('data: '));
          if (dataLine) {
            const json = dataLine.slice(6);
            try {
              const ev = JSON.parse(json) as StreamEvent;
              applyStreamEvent(ev);
              if (ev.type === 'result') sawResult = true;
              if (ev.type === 'error') sawError = true;
            } catch {
              // ignore malformed event
            }
          }
          sep = buffer.indexOf('\n\n');
        }
      }

      if (!sawResult && !sawError) {
        setError(t('Stream beendet ohne Ergebnis', 'Stream ended without a result'));
        setShowConfig(true);
      }
    } catch (e) {
      setError(String(e));
      setShowConfig(true);
    }
    setLoading(false);
  }

  function toggleModule(id: Module) {
    setModules(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  }

  async function downloadJson() {
    if (!result) return;
    const { serialiseJsonExport, exportFilename } = await import('@/lib/audit-export');
    const blob = new Blob([serialiseJsonExport(result)], { type: 'application/json' });
    triggerDownload(blob, exportFilename(result));
  }

  async function downloadCsv() {
    if (!result) return;
    const { buildCsvExport, csvFilename } = await import('@/lib/audit-csv');
    const csv = buildCsvExport(result, csvTable, lang);
    // text/csv;charset=utf-8 + the BOM in the payload makes Excel
    // pick up the encoding without the "Text Import Wizard" prompt.
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, csvFilename(result, csvTable));
  }

  function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadPDF(pdfLang: Lang) {
    if (!result) return;
    const { generatePDF } = await import('@/lib/pdf-generator');
    await generatePDF(result, pdfLang, diff);
  }

  async function copyPrompt() {
    if (!result) return;
    await navigator.clipboard.writeText(result.claudePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const sortedFindings = result ? [...result.findings].sort((a, b) => {
    const o = { critical: 0, important: 1, recommended: 2, optional: 3 };
    return o[a.priority] - o[b.priority];
  }) : [];

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 14, color: 'var(--text)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>SEO Audit Pro</h1>
          <p style={{ color: 'var(--text-muted)', margin: '3px 0 0', fontSize: 13 }}>
            {t('Vollständiger, reproduzierbarer SEO-Audit mit PDF-Export', 'Complete, reproducible SEO audit with PDF export')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {result && (
            <button onClick={() => { setShowConfig(s => !s); }} style={btnStyle}>
              {showConfig ? t('Config ausblenden', 'Hide config') : t('Neuer Audit', 'New audit')}
            </button>
          )}
          <button onClick={() => setLang(l => l === 'de' ? 'en' : 'de')} style={btnStyle}>
            {lang === 'de' ? '🇩🇪 DE' : '🇬🇧 EN'}
          </button>
        </div>
      </div>

      {/* Config panel */}
      {showConfig && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>

          {/* URL */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>{t('Website URL', 'Website URL')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="url"
                name="audit_target_url"
                id="audit-target-url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runAudit()}
                placeholder="https://example.com"
                style={inputStyle}
                autoComplete="off"
                inputMode="url"
                spellCheck={false}
                autoCorrect="off"
                data-kpxc-ignore="true"
              />
              <button onClick={runAudit} disabled={loading || !url.trim()} style={primaryBtnStyle}>
                {loading ? t('Läuft…', 'Running…') : t('Audit starten', 'Start audit')}
              </button>
            </div>
          </div>

          {/* Google API Key */}
          {hasEnvGoogleKey ? (
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--pass-bg)', borderRadius: 8, border: '1px solid var(--pass-border)' }}>
              <span style={{ fontSize: 13, color: 'var(--pass)' }}>✓</span>
              <span style={{ fontSize: 12, color: 'var(--pass)', fontWeight: 500 }}>
                {t('Google API Key aktiv (PageSpeed + Safe Browsing aktiviert)', 'Google API Key active (PageSpeed + Safe Browsing enabled)')}
              </span>
            </div>
          ) : (
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>
                Google API Key <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({t('optional — für PageSpeed & Safe Browsing', 'optional — for PageSpeed & Safe Browsing')})</span>
              </label>
              <input
                value={googleKey}
                onChange={e => setGoogleKey(e.target.value)}
                placeholder="AIza..."
                type="password"
                style={{ ...inputStyle, maxWidth: 400 }}
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
                {t('Oder in .env.local eintragen: GOOGLE_API_KEY=AIza...', 'Or add to .env.local: GOOGLE_API_KEY=AIza...')}
              </p>
            </div>
          )}

          {/* Disclosure: "Erweiterte Optionen" */}
          {(() => {
            // Count how many advanced settings differ from their
            // defaults. Each row in the disclosure contributes 0 or 1
            // — the value lives next to the disclosure label so the
            // user can see at a glance that customised settings are
            // hidden behind the closed panel.
            const defaultModuleSet: Set<Module> = new Set(
              ALL_MODULES.map(m => m.id).filter(m => m !== 'offers' && m !== 'accessibility'),
            );
            const modulesAreDefault =
              modules.length === defaultModuleSet.size &&
              modules.every(m => defaultModuleSet.has(m));
            const adjustments = [
              rendering !== 'auto',
              userAgent !== 'default',
              mobileDesktopParity,
              imageProbeLimit !== 20,
              !!(basicAuthUser.trim() || basicAuthPass.trim()),
              customHeadersText.trim() !== '',
              includePatterns.trim() !== '' || excludePatterns.trim() !== '',
              includeScreenshots,
              !modulesAreDefault,
            ].filter(Boolean).length;

            // Subtle group dividers — applied to the first row of each
            // group transition (positions 5 and 8). Visual cue for the
            // 1-4 / 5-7 / 8-9 grouping without adding section headers.
            const groupDivider: React.CSSProperties = {
              borderTop: '1px solid var(--border-mid)',
              marginTop: '1.5rem',
              paddingTop: '1.5rem',
            };

            // Toggle handler with focus management: on close, if focus
            // is inside the panel, restore it to the toggle button so
            // keyboard users don't land on body when the panel hides.
            const toggleAdvanced = () => {
              if (advancedOpen) {
                const focusInPanel = !!advancedPanelRef.current?.contains(document.activeElement);
                setAdvancedOpen(false);
                if (focusInPanel) {
                  requestAnimationFrame(() => advancedToggleRef.current?.focus());
                }
              } else {
                setAdvancedOpen(true);
              }
            };

            return (
              <div style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  ref={advancedToggleRef}
                  onClick={toggleAdvanced}
                  aria-expanded={advancedOpen}
                  aria-controls="advanced-options-panel"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'none', border: 'none', padding: '8px 0',
                    cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--text)',
                  }}
                >
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {advancedOpen ? '▾' : '▸'}
                  </span>
                  {t('Erweiterte Optionen', 'Advanced options')}
                  {adjustments > 0 && (
                    <span style={{
                      fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 20,
                      background: 'var(--info-bg-banner)', color: 'var(--info)',
                    }}>
                      {t(`${adjustments} angepasst`, `${adjustments} customised`)}
                    </span>
                  )}
                </button>

                <div
                  id="advanced-options-panel"
                  ref={advancedPanelRef}
                  hidden={!advancedOpen}
                  style={{ marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-soft)' }}
                >

                    {/* 1. Rendering mode */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={labelStyle}>
                        {t('Rendering-Modus', 'Rendering mode')}{' '}
                        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                          ({t('JS-Mode rendert über Headless-Chromium — langsamer, aber sieht SPAs', 'JS mode renders via headless Chromium — slower, but sees SPAs')})
                        </span>
                      </label>
                      <select
                        value={rendering}
                        onChange={e => setRendering(e.target.value as 'static' | 'js' | 'auto')}
                        style={{ ...inputStyle, maxWidth: 400 }}
                      >
                        <option value="auto">{t('Auto (Static + JS bei SPA-Erkennung — Default)', 'Auto (static + JS on SPA detection — default)')}</option>
                        <option value="static">{t('Static (HTTP fetch)', 'Static (HTTP fetch)')}</option>
                        <option value="js">{t('JavaScript (Browserless / Chromium für jede Seite)', 'JavaScript (Browserless / Chromium for every page)')}</option>
                      </select>
                    </div>

                    {/* 2. User-Agent */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={labelStyle}>
                        {t('User-Agent', 'User-Agent')} <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>({t('beeinflusst Antwort vom Server und robots.txt-Auswertung', 'affects server response and robots.txt evaluation')})</span>
                      </label>
                      <select
                        value={userAgent}
                        onChange={e => setUserAgent(e.target.value as UserAgentPreset)}
                        style={{ ...inputStyle, maxWidth: 400 }}
                      >
                        {USER_AGENT_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      {userAgent === 'custom' && (
                        <input
                          value={customUserAgent}
                          onChange={e => setCustomUserAgent(e.target.value)}
                          placeholder={t('Eigener User-Agent-String', 'Custom User-Agent string')}
                          style={{ ...inputStyle, maxWidth: 400, marginTop: 6 }}
                        />
                      )}
                    </div>

                    {/* 3. Mobile/Desktop content-parity opt-in */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={mobileDesktopParity}
                          onChange={e => setMobileDesktopParity(e.target.checked)}
                        />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {t('Mobile/Desktop Content-Parität prüfen', 'Check Mobile/Desktop content parity')}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                          ({t('Top-10-Seiten je doppelt fetchen', 'fetches top-10 pages twice each')})
                        </span>
                      </label>
                    </div>

                    {/* 4. Image-size HEAD probe */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={labelStyle}>
                        {t('Bild-Probe-Limit', 'Image probe limit')}{' '}
                        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                          ({t('HEAD-Requests für Datei-Größe; 0 deaktiviert; ~5s pro Bild', 'HEAD requests for file size; 0 disables; ~5s per image')})
                        </span>
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={imageProbeLimit}
                        onChange={e => setImageProbeLimit(parseInt(e.target.value, 10) || 0)}
                        style={{ ...inputStyle, maxWidth: 120 }}
                      />
                    </div>

                    {/* 5. HTTP Basic Auth — start of Auth/Filter group */}
                    <div style={{ ...groupDivider, marginBottom: '1rem' }}>
                      <label style={labelStyle}>
                        {t('HTTP Basic Auth', 'HTTP Basic Auth')}{' '}
                        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                          ({t('für passwortgeschützte Staging-Sites — Credentials werden nicht im Report gespeichert', 'for password-protected staging sites — credentials are not stored in the report')})
                        </span>
                      </label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <input
                          value={basicAuthUser}
                          onChange={e => setBasicAuthUser(e.target.value)}
                          placeholder={t('Benutzername', 'Username')}
                          autoComplete="off"
                          style={inputStyle}
                        />
                        <input
                          value={basicAuthPass}
                          onChange={e => setBasicAuthPass(e.target.value)}
                          placeholder={t('Passwort', 'Password')}
                          type="password"
                          autoComplete="off"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    {/* 6. Custom headers */}
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={labelStyle}>
                        {t('Eigene HTTP-Header', 'Custom HTTP headers')}{' '}
                        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                          ({t('eine pro Zeile, "Name: Wert"; sensible Werte werden im Report maskiert', 'one per line, "Name: value"; sensitive values are masked in the report')})
                        </span>
                      </label>
                      <textarea
                        value={customHeadersText}
                        onChange={e => setCustomHeadersText(e.target.value)}
                        placeholder={'Cookie: session=abc\nX-CF-Bypass: token\nAccept-Language: de-DE,de;q=0.9'}
                        rows={3}
                        style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
                      />
                    </div>

                    {/* 7. Crawler URL filters (Include + Exclude) */}
                    <div ref={includeExcludeRef} style={{ marginBottom: '1rem' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                          <label style={labelStyle}>
                            {t('Include-Patterns', 'Include patterns')}{' '}
                            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                              ({t('eine Regex pro Zeile, gegen volle URL', 'one regex per line, tested against full URL')})
                            </span>
                          </label>
                          <textarea
                            value={includePatterns}
                            onChange={e => {
                              const value = e.target.value;
                              setIncludePatterns(value);
                              // Live re-validate against the current value of
                              // both textareas — fixing include must also
                              // surface a pre-existing exclude error, and
                              // vice versa.
                              setPatternError(checkPatterns(value, excludePatterns));
                            }}
                            placeholder={'/blog/\n/products/'}
                            rows={3}
                            style={{
                              ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11,
                              borderColor: patternError?.which === 'include' ? 'var(--fail)' : undefined,
                            }}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>
                            {t('Exclude-Patterns', 'Exclude patterns')}{' '}
                            <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
                              ({t('Exclude gewinnt', 'exclude wins')})
                            </span>
                          </label>
                          <textarea
                            value={excludePatterns}
                            onChange={e => {
                              const value = e.target.value;
                              setExcludePatterns(value);
                              setPatternError(checkPatterns(includePatterns, value));
                            }}
                            placeholder={'/admin\n\\?utm_\n\\.pdf$'}
                            rows={3}
                            style={{
                              ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11,
                              borderColor: patternError?.which === 'exclude' ? 'var(--fail)' : undefined,
                            }}
                          />
                        </div>
                      </div>
                      {patternError && (
                        <div role="alert" style={{ marginTop: 6, fontSize: 11, color: 'var(--fail)' }}>
                          {t(`Ungültiges Regex-Pattern: "${patternError.pattern}"`, `Invalid regex pattern: "${patternError.pattern}"`)}
                        </div>
                      )}
                    </div>

                    {/* 8. Screenshots — own row, disabled when static-mode; start of Output-Scope group */}
                    <div style={{ ...groupDivider, marginBottom: '1rem' }}>
                      <label style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        cursor: rendering === 'js' ? 'pointer' : 'not-allowed',
                        opacity: rendering === 'js' ? 1 : 0.5,
                      }}>
                        <input
                          type="checkbox"
                          checked={includeScreenshots}
                          disabled={rendering !== 'js'}
                          onChange={e => setIncludeScreenshots(e.target.checked)}
                        />
                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                          {t('Screenshots (Mobile + Desktop) im PDF anhängen', 'Attach Mobile + Desktop screenshots to PDF')}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                          {rendering === 'js'
                            ? `(${t('Top-4-Seiten, je 2 Viewports', 'top 4 pages × 2 viewports')})`
                            : `(${t('nur in JS-Mode verfügbar', 'JS mode only')})`}
                        </span>
                      </label>
                    </div>

                    {/* 9. Modules */}
                    <div>
                      <label style={labelStyle}>{t('Module', 'Modules')}</label>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                        {ALL_MODULES.map(m => (
                          <label key={m.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
                            border: `1px solid ${modules.includes(m.id) ? 'var(--text)' : 'var(--border)'}`,
                            borderRadius: 8, cursor: 'pointer',
                            background: modules.includes(m.id) ? 'var(--bg)' : 'var(--surface)',
                          }}>
                            <input type="checkbox" checked={modules.includes(m.id)} onChange={() => toggleModule(m.id)} style={{ marginTop: 2 }} />
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{isDE ? m.label_de : m.label_en}</div>
                              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 1 }}>{isDE ? m.desc_de : m.desc_en}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Progress */}
      {loading && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.4s ease' }} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            {progressText}
            {progressDetail && (
              <span style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}>· {progressDetail}</span>
            )}
            <span style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}>({Math.round(progress)}%)</span>
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: 'var(--fail-bg)', border: '1px solid var(--fail-border)', borderRadius: 8, padding: '12px 16px', marginBottom: '1.5rem', color: 'var(--fail)' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Top 5 Fixes — highest-impact actions, rendered above everything else */}
          {result.topFindings && result.topFindings.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                {t('Top 5 Fixes — Größter Impact auf deinen Score', 'Top 5 Fixes — Highest Impact on Your Score')}
              </h2>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                {t('Die 5 wichtigsten Maßnahmen für sofortige Score-Verbesserung', 'The 5 most impactful actions for immediate score improvement')}
              </p>
              {result.topFindings.map((f, idx) => {
                const gain = f.priority === 'critical' ? 25 : f.priority === 'important' ? 12 : f.priority === 'recommended' ? 5 : 2;
                const rec = isDE ? f.recommendation_de : f.recommendation_en;
                const recTrim = rec.length > 100 ? rec.slice(0, 100) + '…' : rec;
                return (
                  <div key={f.id} style={{
                    padding: idx === 0 ? '0 0 12px' : '12px 0',
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border-soft)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: PRIORITY_BG[f.priority], color: PRIORITY_COLORS[f.priority],
                        whiteSpace: 'nowrap',
                      }}>
                        {isDE
                          ? { critical: 'Kritisch', important: 'Wichtig', recommended: 'Empfohlen', optional: 'Optional' }[f.priority]
                          : { critical: 'Critical', important: 'Important', recommended: 'Recommended', optional: 'Optional' }[f.priority]
                        }
                      </span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                        {isDE ? f.title_de : f.title_en}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                        background: 'var(--pass-bg)', color: 'var(--pass)', whiteSpace: 'nowrap',
                      }}>
                        +{gain} {t('Pkt.', 'pts')}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 4 }}>
                      <span style={{ textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.03em' }}>{f.module}</span>
                      <span> · {recTrim}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Score overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, marginBottom: '1.5rem' }}>
            {/* Total score */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', textAlign: 'center', minWidth: 110 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {t('Gesamt', 'Total')}
              </div>
              <div style={{ fontSize: 42, fontWeight: 700, color: scoreColor(result.totalScore), lineHeight: 1 }}>{result.totalScore}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>/100</div>
            </div>

            {/* Module scores */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {result.moduleScores.map(ms => (
                <div key={ms.module} style={{ background: scoreBg(ms.score), borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(ms.score) }}>{ms.score}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{isDE ? ms.label_de : ms.label_en}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Diff trigger row */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {cachedPrevious && !diff && (
              <button onClick={openDiffWithCached} style={btnStyle}>
                {t(`Vergleich mit letztem Audit vom ${formatDate(cachedPrevious.cachedAt)}`, `Compare with last audit from ${formatDate(cachedPrevious.cachedAt)}`)}
              </button>
            )}
            {!diff && (
              <>
                <button onClick={handleUploadClick} style={btnStyle}>
                  {t('Vergleich hochladen', 'Upload comparison')}
                </button>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleUploadChange}
                  style={{ display: 'none' }}
                />
              </>
            )}
            {diffError && (
              <span style={{ fontSize: 12, color: 'var(--fail)' }}>{diffError}</span>
            )}
          </div>

          {/* Diff view */}
          {diff && (
            <DiffView diff={diff} isDE={isDE} t={t} onClose={closeDiff} />
          )}

          {/* Summary */}
          <p style={{ color: 'var(--text-strong)', fontSize: 13, lineHeight: 1.7, marginBottom: '1.5rem', padding: '12px 16px', background: 'var(--bg)', borderRadius: 8, borderLeft: '3px solid var(--border)' }}>
            {isDE ? result.summary_de : result.summary_en}
          </p>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: t('Seiten gecrawlt', 'Pages crawled'), value: result.crawlStats.crawledPages },
              { label: t('Findings gesamt', 'Total findings'), value: result.findings.length },
              { label: t('Kritisch', 'Critical'), value: result.findings.filter(f => f.priority === 'critical').length, color: 'var(--fail)' },
              { label: t('Wichtig', 'Important'), value: result.findings.filter(f => f.priority === 'important').length, color: 'var(--warn)' },
              { label: t('Defekte Links', 'Broken links'), value: result.crawlStats.brokenLinks.length, color: result.crawlStats.brokenLinks.length > 0 ? 'var(--fail)' : undefined },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color || 'var(--text)' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          {(() => {
            // Search Console issue count drives the tab badge. Counts
            // ephemeral SSE warnings (api-error blip during this audit)
            // PLUS persisted state from gscResult — so a re-opened
            // cached audit with state=api-error still flags as "(1)"
            // even after the original warning has aged out.
            const gscWarningCount = warnings.filter(w => w.source === 'gsc').length;
            const gscStateIndicator =
              result.gscResult?.state === 'api-error' || result.gscResult?.state === 'property-not-found' ? 1 : 0;
            const gscIssueCount = gscWarningCount + gscStateIndicator;
            const gscLabel = gscIssueCount > 0
              ? `Search Console (${gscIssueCount})`
              : 'Search Console';
            return (
              <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
                {(['findings', 'pages', 'tech', 'gsc', 'prompt'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)} style={{
                    padding: '8px 14px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer',
                    borderBottom: activeTab === tab ? '2px solid var(--text)' : '2px solid transparent',
                    fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? 'var(--text)' : 'var(--text-muted)',
                  }}>
                    {tab === 'findings' && t(`Findings (${result.findings.length})`, `Findings (${result.findings.length})`)}
                    {tab === 'pages' && t(`Seiten (${result.pages.length})`, `Pages (${result.pages.length})`)}
                    {tab === 'tech' && t('SSL & DNS', 'SSL & DNS')}
                    {tab === 'gsc' && gscLabel}
                    {tab === 'prompt' && t('Claude-Prompt', 'Claude Prompt')}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Findings tab */}
          {activeTab === 'findings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
              {sortedFindings.map(f => {
                const isOpen = openFindings.has(f.id);
                return (
                  <div key={f.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    <div
                      onClick={() => setOpenFindings(prev => { const s = new Set(prev); isOpen ? s.delete(f.id) : s.add(f.id); return s; })}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
                    >
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                        background: PRIORITY_BG[f.priority], color: PRIORITY_COLORS[f.priority],
                        whiteSpace: 'nowrap',
                      }}>
                        {isDE
                          ? { critical: 'Kritisch', important: 'Wichtig', recommended: 'Empfohlen', optional: 'Optional' }[f.priority]
                          : { critical: 'Critical', important: 'Important', recommended: 'Recommended', optional: 'Optional' }[f.priority]
                        }
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>{f.module}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{isDE ? f.title_de : f.title_en}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border-soft)' }}>
                        <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 6 }}>
                          {t('Aufwand', 'Effort')}: {f.effort} · {t('Impact', 'Impact')}: {f.impact}
                          {f.affectedUrl && <> · <a href={f.affectedUrl} target="_blank" rel="noopener" style={{ color: 'var(--info)' }}>{f.affectedUrl}</a></>}
                        </div>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-strong)', lineHeight: 1.6 }}>
                          {isDE ? f.description_de : f.description_en}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: PRIORITY_COLORS[f.priority], lineHeight: 1.6 }}>
                          → {isDE ? f.recommendation_de : f.recommendation_en}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Strengths */}
              <div style={{ marginTop: '1rem', background: 'var(--pass-bg)', border: '1px solid var(--pass-border)', borderRadius: 10, padding: '14px 16px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--pass)' }}>
                  {t('Was gut ist', "What's Working Well")}
                </h3>
                {(isDE ? result.strengths_de : result.strengths_en).map((s, i) => (
                  <p key={i} style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--pass-strong)' }}>✓ {s}</p>
                ))}
              </div>
            </div>
          )}

          {/* Pages tab */}
          {activeTab === 'pages' && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      {['URL', 'Title', t('Title Z. / px', 'Title chars / px'), t('Description Z. / px', 'Description chars / px'), 'H1', 'Schema', t('Wörter', 'Words'), t('Bilder/Alt', 'Img/Alt')].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-strong)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.pages.map((p, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--bg)' }}>
                        <td style={tdStyle}>
                          <a href={p.url} target="_blank" rel="noopener" style={{ color: 'var(--info)', fontSize: 11 }}>
                            {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </a>
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 180 }}>
                          {p.title
                            ? <span title={p.title}>{p.title.substring(0, 35)}{p.title.length > 35 ? '…' : ''}</span>
                            : <span style={{ color: 'var(--fail)', fontWeight: 600 }}>FEHLT</span>
                          }
                        </td>
                        <td style={{
                          ...tdStyle,
                          color: (
                            (p.titleLength != null && (p.titleLength < 30 || p.titleLength > 65)) ||
                            (p.titlePixelWidth != null && p.titlePixelWidth > TITLE_LIMIT_MOBILE_PX)
                          ) ? 'var(--warn)' : 'var(--pass)',
                          whiteSpace: 'nowrap',
                        }}>
                          {p.titleLength != null ? (
                            <>
                              {p.titleLength}
                              <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>
                                / {p.titlePixelWidth ?? '—'}px
                              </span>
                            </>
                          ) : '—'}
                        </td>
                        <td style={{
                          ...tdStyle,
                          color: (
                            (p.metaDescriptionLength != null && (p.metaDescriptionLength < 70 || p.metaDescriptionLength > 165)) ||
                            (p.metaDescriptionPixelWidth != null && p.metaDescriptionPixelWidth > META_DESC_LIMIT_PX)
                          ) ? 'var(--warn)' : 'var(--pass)',
                          whiteSpace: 'nowrap',
                        }}>
                          {p.metaDescriptionLength != null ? (
                            <>
                              {p.metaDescriptionLength}
                              <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>
                                / {p.metaDescriptionPixelWidth ?? '—'}px
                              </span>
                            </>
                          ) : '—'}
                        </td>
                        <td style={tdStyle}>
                          {p.h1s.length === 1
                            ? <span style={{ color: 'var(--pass)' }}>✓</span>
                            : p.h1s.length === 0
                              ? <span style={{ color: 'var(--fail)', fontWeight: 600 }}>✗</span>
                              : <span style={{ color: 'var(--warn)' }}>{p.h1s.length}×</span>
                          }
                        </td>
                        <td style={tdStyle}>{p.schemaTypes.slice(0, 2).join(', ') || <span style={{ color: 'var(--text-faint)' }}>—</span>}</td>
                        <td style={{ ...tdStyle, color: p.wordCount < 300 ? 'var(--warn)' : 'var(--text-strong)' }}>{p.wordCount}</td>
                        <td style={{ ...tdStyle, color: p.imagesMissingAlt > 0 ? 'var(--fail)' : 'var(--pass)' }}>
                          {p.imagesMissingAlt}/{p.totalImages}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tech tab */}
          {activeTab === 'tech' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: '1.5rem' }}>
              {/* SSL */}
              {result.sslInfo && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>SSL / HTTPS</h3>
                  <TechRow label="Grade" value={result.sslInfo.grade || '—'} ok={result.sslInfo.valid} />
                  <TechRow label={t('Gültig', 'Valid')} value={result.sslInfo.valid ? '✓' : '✗'} ok={result.sslInfo.valid} />
                  {result.sslInfo.daysUntilExpiry !== undefined && (
                    <TechRow label={t('Läuft ab in', 'Expires in')} value={`${result.sslInfo.daysUntilExpiry} ${t('Tagen', 'days')}`} ok={result.sslInfo.daysUntilExpiry > 30} />
                  )}
                  {result.sslInfo.issuer && <TechRow label="Issuer" value={result.sslInfo.issuer.substring(0, 40)} ok={true} />}
                </div>
              )}

              {/* DNS */}
              {result.dnsInfo && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>DNS / E-Mail</h3>
                  <TechRow label="SPF" value={result.dnsInfo.hasSPF ? '✓' : '✗'} ok={result.dnsInfo.hasSPF} />
                  <TechRow label="DKIM" value={result.dnsInfo.hasDKIM ? '✓' : '✗'} ok={result.dnsInfo.hasDKIM} />
                  <TechRow label="DMARC" value={result.dnsInfo.hasDMARC ? '✓' : '✗'} ok={result.dnsInfo.hasDMARC} />
                  {result.dnsInfo.mxRecords && result.dnsInfo.mxRecords.length > 0 && (
                    <TechRow label="MX" value={result.dnsInfo.mxRecords[0]} ok={true} />
                  )}
                </div>
              )}

              {/* PageSpeed */}
              {result.pageSpeedData && !result.pageSpeedData.error && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>PageSpeed (Mobile)</h3>
                  {result.pageSpeedData.performanceScore !== undefined && <TechRow label="Performance" value={`${result.pageSpeedData.performanceScore}/100`} ok={result.pageSpeedData.performanceScore >= 50} />}
                  {result.pageSpeedData.seoScore !== undefined && <TechRow label="SEO" value={`${result.pageSpeedData.seoScore}/100`} ok={result.pageSpeedData.seoScore >= 75} />}
                  {result.pageSpeedData.accessibilityScore !== undefined && <TechRow label={t('Zugänglichkeit', 'Accessibility')} value={`${result.pageSpeedData.accessibilityScore}/100`} ok={result.pageSpeedData.accessibilityScore >= 75} />}
                  {result.pageSpeedData.lcp && <TechRow label="LCP" value={`${Math.round(result.pageSpeedData.lcp / 100) / 10}s`} ok={result.pageSpeedData.lcp < 2500} />}
                  {result.pageSpeedData.cls !== undefined && <TechRow label="CLS" value={result.pageSpeedData.cls.toFixed(3)} ok={result.pageSpeedData.cls < 0.1} />}
                  {result.pageSpeedData.inp !== undefined && <TechRow label="INP" value={`${Math.round(result.pageSpeedData.inp)}ms`} ok={result.pageSpeedData.inp < 200} />}
                  {result.pageSpeedData.fidField !== undefined && <TechRow label={t('FID (Legacy)', 'FID (legacy)')} value={`${Math.round(result.pageSpeedData.fidField)}ms`} ok={result.pageSpeedData.fidField < 100} />}
                </div>
              )}

              {/* AI Crawler Readiness */}
              {result.aiReadiness && !result.aiReadiness.error && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>{t('AI-Crawler-Readiness', 'AI Crawler Readiness')}</h3>
                  <TechRow label="llms.txt" value={result.aiReadiness.hasLlmsTxt ? t('vorhanden', 'present') : t('fehlt', 'missing')} ok={result.aiReadiness.hasLlmsTxt} />
                  <TechRow label="llms-full.txt" value={result.aiReadiness.hasLlmsFullTxt ? t('vorhanden', 'present') : t('fehlt', 'missing')} ok={result.aiReadiness.hasLlmsFullTxt} />
                  {result.aiReadiness.bots.map(b => (
                    <TechRow
                      key={b.bot}
                      label={`${b.bot} (${b.purpose})`}
                      value={b.status === 'allowed' ? t('erlaubt', 'allowed') : b.status === 'blocked' ? t('blockiert', 'blocked') : b.status === 'partial' ? t('teilweise', 'partial') : t('nicht geregelt', 'unspecified')}
                      ok={b.status === 'allowed' || (b.purpose === 'training' && b.status === 'blocked')}
                    />
                  ))}
                </div>
              )}

              {/* Security Headers */}
              {result.securityHeaders && !result.securityHeaders.error && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>{t('Security Headers', 'Security Headers')}</h3>
                  <TechRow label="HSTS" value={result.securityHeaders.hsts ? (result.securityHeaders.hstsMaxAge ? `max-age=${result.securityHeaders.hstsMaxAge}` : t('gesetzt', 'set')) : t('fehlt', 'missing')} ok={!!result.securityHeaders.hsts && (result.securityHeaders.hstsMaxAge ?? 0) >= 15552000} />
                  <TechRow label="X-Content-Type-Options" value={result.securityHeaders.xContentTypeOptions || t('fehlt', 'missing')} ok={result.securityHeaders.xContentTypeOptions?.toLowerCase() === 'nosniff'} />
                  <TechRow label="X-Frame-Options" value={result.securityHeaders.xFrameOptions || (/frame-ancestors/i.test(result.securityHeaders.csp || '') ? t('via CSP', 'via CSP') : t('fehlt', 'missing'))} ok={!!result.securityHeaders.xFrameOptions || /frame-ancestors/i.test(result.securityHeaders.csp || '')} />
                  <TechRow label="CSP" value={result.securityHeaders.csp ? t('gesetzt', 'set') : t('fehlt', 'missing')} ok={!!result.securityHeaders.csp} />
                  <TechRow label="Referrer-Policy" value={result.securityHeaders.referrerPolicy || t('fehlt', 'missing')} ok={!!result.securityHeaders.referrerPolicy} />
                  <TechRow label="Permissions-Policy" value={result.securityHeaders.permissionsPolicy ? t('gesetzt', 'set') : t('fehlt', 'missing')} ok={!!result.securityHeaders.permissionsPolicy} />
                  {result.securityHeaders.hasMixedContent && (
                    <TechRow label="Mixed Content" value={t('erkannt', 'detected')} ok={false} />
                  )}
                </div>
              )}

              {/* Safe Browsing */}
              {result.safeBrowsingData && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>Google Safe Browsing</h3>
                  <TechRow label={t('Status', 'Status')} value={result.safeBrowsingData.isSafe ? t('Sicher', 'Safe') : t('GEFÄHRLICH', 'DANGEROUS')} ok={result.safeBrowsingData.isSafe} />
                  {result.safeBrowsingData.threats && result.safeBrowsingData.threats.length > 0 && (
                    <TechRow label={t('Bedrohungen', 'Threats')} value={result.safeBrowsingData.threats.join(', ')} ok={false} />
                  )}
                </div>
              )}

              {/* Sitemap Coverage (Checks 1 + 6) */}
              {result.sitemapInfo && !result.sitemapInfo.error && (
                <div style={techCardStyle}>
                  <h3 style={techCardTitle}>{t('Sitemap Coverage', 'Sitemap Coverage')}</h3>
                  <TechRow label={t('URLs in Sitemap', 'URLs in sitemap')} value={String(result.sitemapInfo.urls.length)} ok={result.sitemapInfo.urls.length > 0} />
                  <TechRow label={t('Sitemap-Index', 'Sitemap index')} value={result.sitemapInfo.isIndex ? t('ja', 'yes') : t('nein', 'no')} ok={true} />
                  {result.sitemapInfo.isIndex && (
                    <TechRow label={t('Sub-Sitemaps', 'Sub-sitemaps')} value={String(result.sitemapInfo.subSitemaps.length)} ok={true} />
                  )}
                  <TechRow
                    label={t('URLs mit lastmod', 'URLs with lastmod')}
                    value={`${result.sitemapInfo.urls.filter(e => !!e.lastmod).length}/${result.sitemapInfo.urls.length}`}
                    ok={result.sitemapInfo.urls.some(e => !!e.lastmod)}
                  />
                  <TechRow
                    label={t('Mit Bildern', 'With images')}
                    value={String(result.sitemapInfo.urls.filter(e => e.imageCount > 0).length)}
                    ok={true}
                  />
                  {(() => {
                    const crawledSet = new Set(result.pages.map(p => p.url));
                    const sitemapSet = new Set(result.sitemapInfo!.urls.map(e => e.url));
                    const missingFromCrawl = [...sitemapSet].filter(u => !crawledSet.has(u)).length;
                    const missingFromSitemap = [...crawledSet].filter(u => !sitemapSet.has(u)).length;
                    return (
                      <>
                        <TechRow label={t('In Sitemap, nicht gecrawlt', 'In sitemap, not crawled')} value={String(missingFromCrawl)} ok={missingFromCrawl === 0} />
                        <TechRow label={t('Gecrawlt, nicht in Sitemap', 'Crawled, not in sitemap')} value={String(missingFromSitemap)} ok={missingFromSitemap === 0} />
                      </>
                    );
                  })()}
                </div>
              )}

              {/* Redirects (Check 2) */}
              {(() => {
                const redirected = result.pages.filter(p => p.redirectChain && p.redirectChain.length > 0);
                const chains = redirected.filter(p => p.redirectChain.length > 1);
                const loops = redirected.filter(p => {
                  const seen = new Set<string>();
                  for (const hop of p.redirectChain) {
                    if (seen.has(hop)) return true;
                    seen.add(hop);
                  }
                  return p.redirectChain.includes(p.finalUrl);
                });
                const downgrades = redirected.filter(p =>
                  p.redirectChain[0]?.startsWith('https://') && p.finalUrl.startsWith('http://')
                );
                if (redirected.length === 0 && result.crawlStats.redirectChains.length === 0) return null;
                return (
                  <div style={techCardStyle}>
                    <h3 style={techCardTitle}>{t('Redirects', 'Redirects')}</h3>
                    <TechRow label={t('Mit Redirect gecrawlt', 'Crawled via redirect')} value={String(redirected.length)} ok={redirected.length === 0} />
                    <TechRow label={t('Ketten (>1 Hop)', 'Chains (>1 hop)')} value={String(chains.length)} ok={chains.length === 0} />
                    <TechRow label={t('Schleifen', 'Loops')} value={String(loops.length)} ok={loops.length === 0} />
                    <TechRow label={t('HTTPS → HTTP', 'HTTPS → HTTP')} value={String(downgrades.length)} ok={downgrades.length === 0} />
                  </div>
                );
              })()}

              {/* Link Quality (Checks 3 + 4) */}
              {(() => {
                const totalGeneric = result.pages.reduce((s, p) => s + (p.genericAnchors?.length || 0), 0);
                const totalEmpty = result.pages.reduce((s, p) => s + (p.emptyAnchors || 0), 0);
                const pagesWithNoindex = result.pages.filter(p => p.hasNoindex).length;
                const genericPages = result.pages.filter(p => (p.genericAnchors?.length || 0) > 0).length;
                if (totalGeneric === 0 && totalEmpty === 0 && pagesWithNoindex === 0) return null;
                return (
                  <div style={techCardStyle}>
                    <h3 style={techCardTitle}>{t('Link Quality', 'Link Quality')}</h3>
                    <TechRow label={t('Generische Ankertexte', 'Generic anchor texts')} value={String(totalGeneric)} ok={totalGeneric === 0} />
                    <TechRow label={t('Seiten davon betroffen', 'Pages affected')} value={String(genericPages)} ok={genericPages === 0} />
                    <TechRow label={t('Links ohne Text', 'Links without text')} value={String(totalEmpty)} ok={totalEmpty === 0} />
                    <TechRow label={t('Seiten mit noindex', 'Pages with noindex')} value={String(pagesWithNoindex)} ok={true} />
                  </div>
                );
              })()}

              {/* Crawl stats */}
              <div style={techCardStyle}>
                <h3 style={techCardTitle}>{t('Crawl-Statistik', 'Crawl Statistics')}</h3>
                <TechRow label={t('Seiten gecrawlt', 'Pages crawled')} value={String(result.crawlStats.crawledPages)} ok={true} />
                <TechRow label={t('Defekte Links', 'Broken links')} value={String(result.crawlStats.brokenLinks.length)} ok={result.crawlStats.brokenLinks.length === 0} />
                <TechRow label={t('Weiterleitungen', 'Redirects')} value={String(result.crawlStats.redirectChains.length)} ok={result.crawlStats.redirectChains.length < 3} />
                <TechRow label={t('Externe Links', 'External links')} value={String(result.crawlStats.externalLinks)} ok={true} />
              </div>
            </div>
          )}

          {/* Search Console tab — always rendered, banner per gscResult.state. */}
          {activeTab === 'gsc' && <>
            {(() => {
            const r = result.gscResult;
            if (!r || r.state === 'disabled') {
              return (
                <div style={{ marginBottom: '1.5rem' }}>
                  <StatusBanner
                    variant="info"
                    title={t('Google Search Console nicht aktiviert', 'Google Search Console not enabled')}
                  >
                    {t(
                      'Setze GSC_REFRESH_TOKEN in deiner Umgebung, um Indexabdeckung und Top-Queries dieses Audits zu sehen.',
                      'Set GSC_REFRESH_TOKEN in your environment to see indexing coverage and top queries for this audit.',
                    )}
                  </StatusBanner>
                </div>
              );
            }
            if (r.state === 'property-not-found') {
              return (
                <div style={{ marginBottom: '1.5rem' }}>
                  <StatusBanner
                    variant="info"
                    title={t(
                      `Domain ${r.domain} ist nicht in deinem Search-Console-Konto verfügbar`,
                      `Domain ${r.domain} is not available in your Search Console account`,
                    )}
                  >
                    {t(
                      `${r.sitesAvailable} andere Properties gefunden. Füge die Domain in https://search.google.com/search-console hinzu und führe den Audit erneut aus.`,
                      `${r.sitesAvailable} other properties found. Add the domain in https://search.google.com/search-console and re-run the audit.`,
                    )}
                  </StatusBanner>
                </div>
              );
            }
            if (r.state === 'api-error') {
              return (
                <div style={{ marginBottom: '1.5rem' }}>
                  <StatusBanner
                    variant="error"
                    title={t('Search Console API-Fehler', 'Search Console API error')}
                  >
                    {r.message}
                    <div style={{ marginTop: 6 }}>
                      {t(
                        'Bitte ein neues Audit starten, um aktuelle Daten zu laden.',
                        'Please start a new audit to fetch current data.',
                      )}
                    </div>
                  </StatusBanner>
                </div>
              );
            }
            // r.state === 'ok' — banner + queries + pages tables.
            const variantLabel = r.data.resolved.variant === 'domain'
              ? t('Domain-Property', 'Domain property')
              : `${t('URL-Property', 'URL property')}: ${r.data.resolved.siteUrl}`;
            return (
              <div style={{ marginBottom: '1.5rem' }}>
                <StatusBanner
                  variant="ok"
                  title={t('Search Console verbunden', 'Search Console connected')}
                >
                  {variantLabel}
                  {t(
                    `, Daten vom ${formatDate(r.data.startDate)} bis ${formatDate(r.data.endDate)}`,
                    `, data from ${formatDate(r.data.startDate)} to ${formatDate(r.data.endDate)}`,
                  )}
                </StatusBanner>

                {/* Top queries */}
                <div style={{ marginTop: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {t('Top-Suchanfragen', 'Top queries')}
                  </h3>
                  <GscRowsTable
                    rows={r.data.topQueries}
                    totals={r.data.totals}
                    keyHeader={t('Suchanfrage', 'Query')}
                    renderKey={(k: string) => k}
                    isDE={isDE}
                  />
                </div>

                {/* Top pages */}
                <div style={{ marginTop: '1.5rem' }}>
                  <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {t('Top-Seiten', 'Top pages')}
                  </h3>
                  <GscRowsTable
                    rows={r.data.topPages}
                    totals={r.data.totals}
                    keyHeader={t('Seite', 'Page')}
                    renderKey={(url: string) => {
                      // Display path only (full URL on hover + new-tab on click)
                      // — full URLs wrap awkwardly on mobile widths.
                      let display = url;
                      try {
                        const u = new URL(url);
                        display = u.pathname + u.search;
                        if (display === '') display = '/';
                      } catch {
                        /* fallthrough — keep raw */
                      }
                      return (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={url}
                          style={{ color: 'var(--info)', textDecoration: 'none' }}
                        >
                          {display}
                        </a>
                      );
                    }}
                    isDE={isDE}
                  />
                </div>
              </div>
            );
            })()}

            {/* Warnings stack — ephemeral mid-stream notices from the
                GSC pipeline. Filtered by source so future Browserless
                / axe-core / Bing warnings don't leak into this tab.
                Hidden when state === 'api-error' to avoid duplicating
                the persistent error banner (see getVisibleGscWarnings
                for the design rationale). Dismissible: user can clear
                each banner once read; setWarnings([]) in runAudit()
                clears them all on the next audit. */}
            {(() => {
              const visible = getVisibleGscWarnings(warnings, result.gscResult);
              if (visible.length === 0) return null;
              return (
                <div style={{ marginBottom: '1.5rem' }}>
                  {visible.map((w, i) => (
                    <StatusBanner
                      key={i}
                      variant="warning"
                      title={t('Search Console — Warnung beim Abruf', 'Search Console — fetch warning')}
                      onDismiss={() => setWarnings(arr => arr.filter(other => other !== w))}
                    >
                      {w.message}
                    </StatusBanner>
                  ))}
                </div>
              );
            })()}
          </>}

          {/* Claude Prompt tab */}
          {activeTab === 'prompt' && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t('Claude-Prompt für Deep Analysis', 'Claude Prompt for Deep Analysis')}</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('Kopiere diesen Prompt und führe ihn in Claude aus für Content- & UX-Analyse', 'Copy this prompt and run it in Claude for content & UX analysis')}
                    </p>
                  </div>
                  <button onClick={copyPrompt} style={primaryBtnStyle}>
                    {copied ? t('Kopiert! ✓', 'Copied! ✓') : t('Prompt kopieren', 'Copy prompt')}
                  </button>
                </div>
                <textarea
                  readOnly
                  value={result.claudePrompt}
                  style={{ width: '100%', height: 400, fontSize: 11, fontFamily: 'monospace', border: '1px solid var(--border)', borderRadius: 6, padding: '10px', background: 'var(--surface)', resize: 'vertical', color: 'var(--text-strong)' }}
                />
              </div>
            </div>
          )}

          {/* Exports */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={csvTable}
              onChange={e => setCsvTable(e.target.value as typeof csvTable)}
              style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 12 }}
              title={t('Tabelle für CSV-Export wählen', 'Pick CSV export table')}
            >
              <option value="findings">{t('Findings', 'Findings')}</option>
              <option value="pages">{t('Seiten', 'Pages')}</option>
              <option value="broken-links">{t('Defekte Links', 'Broken links')}</option>
              <option value="error-pages">{t('Fehlerseiten', 'Error pages')}</option>
              <option value="sitemap-urls">{t('Sitemap-URLs', 'Sitemap URLs')}</option>
              <option value="redirects">{t('Weiterleitungen', 'Redirects')}</option>
            </select>
            <button onClick={downloadCsv} style={btnStyle}>📊 CSV</button>
            <button onClick={downloadJson} style={btnStyle} title={t('Vollständiger Audit-Datensatz als JSON', 'Full audit dataset as JSON')}>
              {'{ } JSON'}
            </button>
            <button onClick={() => downloadPDF('de')} style={btnStyle}>📄 PDF Deutsch</button>
            <button onClick={() => downloadPDF('en')} style={btnStyle}>📄 PDF English</button>
          </div>
        </>
      )}
    </div>
  );
}

function TechRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border-soft)', fontSize: 12 }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: ok ? 'var(--pass)' : 'var(--fail)' }}>{value}</span>
    </div>
  );
}

function DiffView({ diff, isDE, t, onClose }: {
  diff: AuditDiff;
  isDE: boolean;
  t: (de: string, en: string) => string;
  onClose: () => void;
}) {
  const deltaColor = diff.scoreDelta > 0 ? 'var(--pass)' : diff.scoreDelta < 0 ? 'var(--fail)' : 'var(--text-muted)';
  const deltaSign = diff.scoreDelta > 0 ? '+' : '';
  const previousLabel = (() => {
    try {
      return new Date(diff.previousAuditDate).toLocaleDateString(isDE ? 'de-DE' : 'en-GB', {
        year: 'numeric', month: 'long', day: 'numeric',
      });
    } catch { return diff.previousAuditDate; }
  })();

  const findingRow = (f: Finding) => (
    <div key={f.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 12,
        background: PRIORITY_BG[f.priority], color: PRIORITY_COLORS[f.priority],
        whiteSpace: 'nowrap',
      }}>
        {isDE
          ? { critical: 'Kritisch', important: 'Wichtig', recommended: 'Empfohlen', optional: 'Optional' }[f.priority]
          : { critical: 'Critical', important: 'Important', recommended: 'Recommended', optional: 'Optional' }[f.priority]
        }
      </span>
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{isDE ? f.title_de : f.title_en}</span>
      <span style={{ fontSize: 10, color: 'var(--text-faint)', textTransform: 'uppercase' }}>{f.module}</span>
    </div>
  );

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
          {t('Audit-Vergleich', 'Audit Comparison')}
        </h2>
        <button onClick={onClose} style={btnStyle}>{t('Diff schließen', 'Close diff')}</button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
        {t(`Vergleich: ${diff.domain} — ${previousLabel} → Heute`, `Comparison: ${diff.domain} — ${previousLabel} → Today`)}
      </p>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: deltaColor }}>
          {deltaSign}{diff.scoreDelta} {t('Punkte', 'points')}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          ({diff.previousAudit.totalScore} → {diff.currentAudit.totalScore})
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--pass)' }}>
            ✅ {t(`Behoben (${diff.resolved.length})`, `Resolved (${diff.resolved.length})`)}
          </h3>
          {diff.resolved.length === 0
            ? <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>—</p>
            : diff.resolved.map(findingRow)}
        </div>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--fail)' }}>
            🆕 {t(`Neu (${diff.new.length})`, `New (${diff.new.length})`)}
          </h3>
          {diff.new.length === 0
            ? <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>—</p>
            : diff.new.map(findingRow)}
        </div>
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
            ➡ {t(`Unverändert (${diff.unchanged.length})`, `Unchanged (${diff.unchanged.length})`)}
          </h3>
          {diff.unchanged.length === 0
            ? <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: 0 }}>—</p>
            : diff.unchanged.slice(0, 10).map(findingRow)}
          {diff.unchanged.length > 10 && (
            <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '4px 0 0' }}>
              +{diff.unchanged.length - 10} {t('weitere', 'more')}
            </p>
          )}
        </div>
      </div>

      {diff.moduleDeltas.length > 0 && (
        <div>
          <h3 style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
            {t('Modul-Scores', 'Module scores')}
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid var(--border)' }}>{t('Modul', 'Module')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', border: '1px solid var(--border)' }}>{t('Vorher', 'Before')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', border: '1px solid var(--border)' }}>{t('Nachher', 'After')}</th>
                <th style={{ padding: '6px 8px', textAlign: 'right', border: '1px solid var(--border)' }}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {diff.moduleDeltas.map(md => {
                const prev = diff.previousAudit.moduleScores.find(m => m.module === md.module)?.score ?? 0;
                const curr = diff.currentAudit.moduleScores.find(m => m.module === md.module)?.score ?? 0;
                const color = md.delta > 0 ? 'var(--pass)' : md.delta < 0 ? 'var(--fail)' : 'var(--text-muted)';
                return (
                  <tr key={md.module}>
                    <td style={{ padding: '5px 8px', border: '1px solid var(--border)', textTransform: 'uppercase', fontSize: 11 }}>{md.module}</td>
                    <td style={{ padding: '5px 8px', border: '1px solid var(--border)', textAlign: 'right' }}>{prev}</td>
                    <td style={{ padding: '5px 8px', border: '1px solid var(--border)', textAlign: 'right' }}>{curr}</td>
                    <td style={{ padding: '5px 8px', border: '1px solid var(--border)', textAlign: 'right', color, fontWeight: 600 }}>
                      {md.delta > 0 ? '+' : ''}{md.delta}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  height: 36, padding: '0 14px', fontSize: 12, fontWeight: 500,
  border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)',
  color: 'var(--text)', cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle, background: 'var(--text)', color: 'var(--surface)', border: '1px solid var(--text)',
};

const inputStyle: React.CSSProperties = {
  flex: 1, height: 40, padding: '0 12px', fontSize: 14,
  border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)',
  color: 'var(--text)', outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: 'var(--text-strong)',
};

const techCardStyle: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px',
};

const techCardTitle: React.CSSProperties = {
  margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--text)',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--border)', verticalAlign: 'top',
};
