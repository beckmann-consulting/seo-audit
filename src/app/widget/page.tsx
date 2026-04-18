'use client';

import { useEffect, useRef, useState } from 'react';

type Lang = 'de' | 'en';

interface WidgetFinding {
  id: string;
  priority: 'critical' | 'important' | 'recommended' | 'optional';
  module: string;
  title_de: string;
  title_en: string;
  recommendation_de: string;
  recommendation_en: string;
}

interface WidgetAuditResponse {
  domain: string;
  score: number;
  topFindings: WidgetFinding[];
  moduleScores: { module: string; score: number }[];
  auditDuration: number;
}

type WidgetState =
  | { kind: 'input' }
  | { kind: 'loading'; domain: string }
  | { kind: 'result'; data: WidgetAuditResponse }
  | { kind: 'error'; message: string };

const BRAND_ORANGE = '#FF7A00';

// Color palette per mode. The widget is rendered either:
//   - standalone (?embed=0/missing) → light theme on a white card,
//   - embedded   (?embed=1)         → fully transparent, light text on a
//                                      dark parent (beckmanndigital.com).
type Theme = {
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  inputBg: string;
  inputBorder: string;
  inputText: string;
  ringTrack: string;
  findingBorder: string;
  emailBoxBg: string;
  emailBoxBorder: string;
  secondaryBtnBg: string;
  secondaryBtnText: string;
  badgeBg: Record<string, string>;
  badgeFg: Record<string, string>;
};

const STANDALONE_THEME: Theme = {
  cardBg: '#fff',
  cardBorder: `2px solid ${BRAND_ORANGE}`,
  textPrimary: '#1a1a1a',
  textSecondary: '#555',
  textMuted: '#888',
  inputBg: '#fff',
  inputBorder: '#e0e0e0',
  inputText: '#1a1a1a',
  ringTrack: '#e0e0e0',
  findingBorder: '#e0e0e0',
  emailBoxBg: '#fafaf8',
  emailBoxBorder: 'transparent',
  secondaryBtnBg: '#1a1a1a',
  secondaryBtnText: '#fff',
  badgeBg: {
    critical: '#fcebeb',
    important: '#faeeda',
    recommended: '#e6f1fb',
    optional: '#f1efe8',
  },
  badgeFg: {
    critical: '#a32d2d',
    important: '#854f0b',
    recommended: '#185fa5',
    optional: '#555',
  },
};

const EMBED_THEME: Theme = {
  cardBg: 'transparent',
  cardBorder: 'none',
  textPrimary: 'rgba(255,255,255,0.95)',
  textSecondary: 'rgba(255,255,255,0.65)',
  textMuted: 'rgba(255,255,255,0.45)',
  inputBg: 'rgba(255,255,255,0.06)',
  inputBorder: 'rgba(255,255,255,0.18)',
  inputText: '#fff',
  ringTrack: 'rgba(255,255,255,0.12)',
  findingBorder: 'rgba(255,255,255,0.14)',
  emailBoxBg: 'rgba(255,255,255,0.04)',
  emailBoxBorder: 'rgba(255,255,255,0.1)',
  secondaryBtnBg: BRAND_ORANGE,
  secondaryBtnText: '#fff',
  badgeBg: {
    critical: 'rgba(211,47,47,0.18)',
    important: 'rgba(245,158,11,0.18)',
    recommended: 'rgba(74,155,222,0.18)',
    optional: 'rgba(255,255,255,0.08)',
  },
  badgeFg: {
    critical: '#ff7676',
    important: '#f4b35c',
    recommended: '#7fb6e8',
    optional: 'rgba(255,255,255,0.7)',
  },
};

function scoreColor(s: number): string {
  if (s >= 80) return '#4A9B8E';
  if (s >= 50) return '#F59E0B';
  return '#D32F2F';
}

export default function WidgetPage() {
  const [lang, setLang] = useState<Lang>('de');
  const [embed, setEmbed] = useState(false);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<WidgetState>({ kind: 'input' });
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailError, setEmailError] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Read ?lang= and ?embed= from the URL once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const l = params.get('lang');
    if (l === 'en' || l === 'de') setLang(l);
    if (params.get('embed') === '1') setEmbed(true);
  }, []);

  // RootLayout sets a beige body background and min-height: 100vh that would
  // otherwise leak through the iframe and force the iframe to be at least
  // viewport-tall. In embed mode we override both so the parent page shows
  // through and the iframe shrinks tightly to the widget content.
  // Also clamp horizontal overflow so the iframe never shows a scroll-x
  // bar — any rogue fixed-width element just gets clipped instead.
  useEffect(() => {
    if (typeof document === 'undefined' || !embed) return;
    const body = document.body;
    const html = document.documentElement;
    const prevBodyBg = body.style.background;
    const prevHtmlBg = html.style.background;
    const prevBodyMinH = body.style.minHeight;
    const prevBodyOverflowX = body.style.overflowX;
    const prevHtmlOverflowX = html.style.overflowX;
    body.style.background = 'transparent';
    html.style.background = 'transparent';
    body.style.minHeight = '0';
    body.style.overflowX = 'hidden';
    html.style.overflowX = 'hidden';
    return () => {
      body.style.background = prevBodyBg;
      html.style.background = prevHtmlBg;
      body.style.minHeight = prevBodyMinH;
      body.style.overflowX = prevBodyOverflowX;
      html.style.overflowX = prevHtmlOverflowX;
    };
  }, [embed]);

  // Resize the embedding iframe whenever layout changes. Report on every
  // state transition (instant) AND on layout reflow (ResizeObserver —
  // catches font swap, viewport rotation, flex-wrap breakpoints) so the
  // parent iframe is always exactly tall enough — no internal scrollbar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const postHeight = () => {
      const h = document.body.scrollHeight;
      if (h <= 0) return;
      window.parent.postMessage({ type: 'seo-audit-resize', height: h }, '*');
    };
    postHeight();
    const t = setTimeout(postHeight, 200);
    return () => clearTimeout(t);
  }, [state, emailSent, emailError]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const postHeight = () => {
      const h = document.body.scrollHeight;
      if (h <= 0) return;
      window.parent.postMessage({ type: 'seo-audit-resize', height: h }, '*');
    };
    const observer = new ResizeObserver(postHeight);
    observer.observe(document.body);
    window.addEventListener('resize', postHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', postHeight);
    };
  }, []);

  const isDE = lang === 'de';
  const t = (de: string, en: string) => (isDE ? de : en);
  const theme = embed ? EMBED_THEME : STANDALONE_THEME;

  function isValidUrl(raw: string): boolean {
    let u = raw.trim();
    if (!u) return false;
    if (!u.startsWith('http')) u = 'https://' + u;
    try {
      const parsed = new URL(u);
      return !!parsed.hostname && parsed.hostname.includes('.');
    } catch {
      return false;
    }
  }

  async function startAudit() {
    const raw = url.trim();
    if (!isValidUrl(raw)) {
      setState({ kind: 'error', message: t('Bitte gültige URL eingeben.', 'Please enter a valid URL.') });
      return;
    }
    let normalised = raw;
    if (!normalised.startsWith('http')) normalised = 'https://' + normalised;
    const domain = (() => {
      try { return new URL(normalised).hostname; } catch { return normalised; }
    })();

    setState({ kind: 'loading', domain });

    try {
      const resp = await fetch('/api/widget/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalised, lang }),
      });
      if (resp.status === 429) {
        setState({ kind: 'error', message: t('Bitte versuchen Sie es später erneut.', 'Please try again later.') });
        return;
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const msg = typeof body === 'object' && body && 'message' in body
          ? String((body as { message: unknown }).message)
          : t('Audit fehlgeschlagen.', 'Audit failed.');
        setState({ kind: 'error', message: msg });
        return;
      }
      const data = await resp.json() as WidgetAuditResponse;
      setState({ kind: 'result', data });
    } catch (err) {
      setState({ kind: 'error', message: `${t('Netzwerkfehler', 'Network error')}: ${String(err)}` });
    }
  }

  async function submitEmail() {
    if (state.kind !== 'result') return;
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setEmailError(t('Bitte gültige E-Mail-Adresse eingeben.', 'Please enter a valid email address.'));
      return;
    }
    setEmailError('');
    try {
      await fetch('/api/widget/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: state.data.domain,
          email: addr,
          lang,
          emailCapture: true,
        }),
      });
      setEmailSent(true);
    } catch {
      setEmailError(t('Übertragung fehlgeschlagen.', 'Submission failed.'));
    }
  }

  return (
    <div ref={rootRef} style={{
      maxWidth: 520,
      margin: '0 auto',
      padding: '24px 20px',
      border: theme.cardBorder,
      borderRadius: 12,
      background: theme.cardBg,
      boxSizing: 'border-box',
      color: theme.textPrimary,
    }}>
      {/* Logo — only in standalone mode (parent site brands the embed) */}
      {!embed && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/TWB_Logo_Transparent.png" alt="TWB" style={{ height: 30, width: 'auto' }} />
        </div>
      )}

      {state.kind === 'input' && (
        <>
          <h1 style={{ margin: '0 0 4px', textAlign: 'center', fontSize: 20, fontWeight: 700, color: theme.textPrimary }}>
            {t('Kostenlosen SEO-Audit starten', 'Start Free SEO Audit')}
          </h1>
          <p style={{ margin: '0 0 16px', textAlign: 'center', fontSize: 12, color: theme.textSecondary }}>
            {t('In 30 Sekunden Score, Top-Fixes und Empfehlungen.', 'Score, top fixes and recommendations in 30 seconds.')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startAudit()}
              placeholder={t('https://ihre-website.de', 'https://your-website.com')}
              type="url"
              style={{
                flex: '1 1 200px',
                minWidth: 0,
                height: 42,
                padding: '0 12px',
                fontSize: 14,
                background: theme.inputBg,
                border: `1px solid ${theme.inputBorder}`,
                color: theme.inputText,
                borderRadius: 8,
                outline: 'none',
              }}
            />
            <button
              onClick={startAudit}
              style={{
                flex: '0 1 auto',
                height: 42,
                padding: '0 18px',
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                background: BRAND_ORANGE,
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {t('Analysieren', 'Analyse')}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: theme.textMuted, textAlign: 'center' }}>
            {t('Kein Account. Kein Spam. Nur Ergebnisse.', 'No account. No spam. Just results.')}
          </p>
        </>
      )}

      {state.kind === 'loading' && (
        <>
          <h2 style={{ margin: '8px 0 16px', textAlign: 'center', fontSize: 16, fontWeight: 600, color: theme.textPrimary }}>
            {t(`Analysiere ${state.domain}…`, `Analysing ${state.domain}…`)}
          </h2>
          <div style={{
            position: 'relative',
            height: 6,
            background: theme.ringTrack,
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              inset: 0,
              background: BRAND_ORANGE,
              animation: 'seoAuditPulse 1.3s ease-in-out infinite',
              transformOrigin: 'left center',
            }} />
          </div>
          <p style={{ margin: '12px 0 0', textAlign: 'center', fontSize: 12, color: theme.textMuted }}>
            {t('Crawl, PageSpeed, Security Headers — ca. 20-40 Sekunden.', 'Crawl, PageSpeed, security headers — about 20-40 seconds.')}
          </p>
          <style>{`
            @keyframes seoAuditPulse {
              0% { transform: scaleX(0.1); opacity: 0.7; }
              50% { transform: scaleX(0.9); opacity: 1; }
              100% { transform: scaleX(0.1); opacity: 0.7; }
            }
          `}</style>
        </>
      )}

      {state.kind === 'error' && (
        <>
          <p style={{ margin: '8px 0', textAlign: 'center', fontSize: 14, color: '#a32d2d' }}>
            {state.message}
          </p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              onClick={() => setState({ kind: 'input' })}
              style={{
                height: 38, padding: '0 16px', fontSize: 13, fontWeight: 600,
                border: `1px solid ${theme.inputBorder}`, borderRadius: 8,
                background: theme.inputBg, color: theme.textPrimary, cursor: 'pointer',
              }}
            >
              {t('Erneut versuchen', 'Try again')}
            </button>
          </div>
        </>
      )}

      {state.kind === 'result' && (
        <ResultView
          data={state.data}
          isDE={isDE}
          t={t}
          theme={theme}
          email={email}
          setEmail={setEmail}
          emailSent={emailSent}
          emailError={emailError}
          onSubmitEmail={submitEmail}
        />
      )}

      <p style={{ margin: '18px 0 0', textAlign: 'center', fontSize: 10, color: theme.textMuted }}>
        SEO Audit by{' '}
        <a href="https://beckmanndigital.com" target="_blank" rel="noopener noreferrer" style={{ color: BRAND_ORANGE, textDecoration: 'none' }}>
          Beckmann Digital
        </a>
      </p>
    </div>
  );
}

function ResultView({
  data, isDE, t, theme, email, setEmail, emailSent, emailError, onSubmitEmail,
}: {
  data: WidgetAuditResponse;
  isDE: boolean;
  t: (de: string, en: string) => string;
  theme: Theme;
  email: string;
  setEmail: (v: string) => void;
  emailSent: boolean;
  emailError: string;
  onSubmitEmail: () => void;
}) {
  const color = scoreColor(data.score);
  const label = data.score >= 80
    ? t('Gut', 'Good')
    : data.score >= 50
      ? t('Verbesserungsbedarf', 'Needs improvement')
      : t('Kritisch', 'Critical');

  // SVG ring — circumference = 2π × r = ~314 for r=50
  const r = 50;
  const circumference = 2 * Math.PI * r;
  const dashFilled = (data.score / 100) * circumference;
  const dashGap = circumference - dashFilled;

  const fullAuditUrl = `https://beckmanndigital.com/seo-audit?url=${encodeURIComponent('https://' + data.domain)}`;

  return (
    <div>
      {/* Score circle */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={r} fill="none" stroke={theme.ringTrack} strokeWidth="8" />
          <circle
            cx="60" cy="60" r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={`${dashFilled} ${dashGap}`}
            strokeDashoffset="0"
            strokeLinecap="round"
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="64" textAnchor="middle" fontSize="30" fontWeight="700" fill={color} fontFamily="system-ui, sans-serif">
            {data.score}
          </text>
          <text x="60" y="82" textAnchor="middle" fontSize="10" fill={theme.textMuted} fontFamily="system-ui, sans-serif">
            / 100
          </text>
        </svg>
        <p style={{ margin: '6px 0 0', fontSize: 14, fontWeight: 600, color }}>{label}</p>
        <p style={{ margin: '2px 0 0', fontSize: 12, color: theme.textSecondary }}>{data.domain}</p>
      </div>

      {/* Top 3 findings — recommendation lines are gated behind the email lead */}
      {data.topFindings.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>
            {t('Top 3 Handlungsempfehlungen', 'Top 3 Action Items')}
          </h3>
          {data.topFindings.map(f => {
            const title = isDE ? f.title_de : f.title_en;
            const rec = isDE ? f.recommendation_de : f.recommendation_en;
            const recTrim = rec.length > 80 ? rec.slice(0, 80) + '…' : rec;
            return (
              <div key={f.id} style={{
                border: `1px solid ${theme.findingBorder}`, borderRadius: 8, padding: '8px 10px', marginBottom: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                    background: theme.badgeBg[f.priority], color: theme.badgeFg[f.priority],
                    whiteSpace: 'nowrap',
                  }}>
                    {isDE
                      ? { critical: 'Kritisch', important: 'Wichtig', recommended: 'Empfohlen', optional: 'Optional' }[f.priority]
                      : { critical: 'Critical', important: 'Important', recommended: 'Recommended', optional: 'Optional' }[f.priority]
                    }
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>{title}</span>
                </div>
                {emailSent ? (
                  <p style={{ margin: 0, fontSize: 11, color: theme.textSecondary, lineHeight: 1.4 }}>{recTrim}</p>
                ) : (
                  <p style={{
                    margin: 0, fontSize: 11, color: theme.textMuted, lineHeight: 1.4,
                    fontStyle: 'italic',
                  }}>
                    🔒 {t(
                      'Umsetzungs-Details nach E-Mail-Freischaltung sichtbar',
                      'Implementation details unlocked after email',
                    )}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Email capture / lead gate */}
      <div style={{
        padding: '12px 14px', background: theme.emailBoxBg,
        border: `1px solid ${theme.emailBoxBorder}`,
        borderRadius: 8, marginBottom: 12,
      }}>
        {emailSent ? (
          <p style={{ margin: 0, fontSize: 13, color: '#4A9B8E', fontWeight: 600, textAlign: 'center' }}>
            {t('Danke! Umsetzungs-Details wurden freigeschaltet — wir melden uns.', 'Thanks! Implementation details unlocked — we will be in touch.')}
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: theme.textPrimary }}>
              {t(
                'Geben Sie Ihre E-Mail ein, um die Umsetzungs-Details zu allen Empfehlungen freizuschalten.',
                'Enter your email to unlock the implementation details for all recommendations.',
              )}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSubmitEmail()}
                placeholder="name@example.com"
                type="email"
                style={{
                  flex: '1 1 180px', minWidth: 0, height: 36, padding: '0 10px', fontSize: 13,
                  background: theme.inputBg, color: theme.inputText,
                  border: `1px solid ${theme.inputBorder}`, borderRadius: 6, outline: 'none',
                }}
              />
              <button
                onClick={onSubmitEmail}
                style={{
                  flex: '0 1 auto',
                  height: 36, padding: '0 14px', fontSize: 12, fontWeight: 600,
                  border: 'none', borderRadius: 6,
                  background: theme.secondaryBtnBg, color: theme.secondaryBtnText,
                  cursor: 'pointer',
                }}
              >
                {t('Details freischalten', 'Unlock details')}
              </button>
            </div>
            {emailError && (
              <p style={{ margin: '6px 0 0', fontSize: 11, color: '#a32d2d' }}>{emailError}</p>
            )}
            <p style={{ margin: '6px 0 0', fontSize: 10, color: theme.textMuted }}>
              {t(
                'Ihre E-Mail wird nur zur Kontaktaufnahme verwendet, kein Newsletter.',
                'Your email will only be used to get in touch — no newsletter.',
              )}
            </p>
          </>
        )}
      </div>

      {/* CTA */}
      <a
        href={fullAuditUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '12px 16px',
          background: BRAND_ORANGE,
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          borderRadius: 8,
          textDecoration: 'none',
        }}
      >
        {t('Vollständigen Audit auf beckmanndigital.com →', 'Full audit on beckmanndigital.com →')}
      </a>
    </div>
  );
}
