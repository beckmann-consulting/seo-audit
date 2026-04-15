'use client';

import { useState, useRef, useEffect } from 'react';
import type { AuditResult, Module, AuditConfig, Lang } from '@/types';

const ALL_MODULES: { id: Module; label_de: string; label_en: string; desc_de: string; desc_en: string }[] = [
  { id: 'seo', label_de: 'SEO', label_en: 'SEO', desc_de: 'Meta-Tags, Sitemap, Schema, Canonical', desc_en: 'Meta tags, sitemap, schema, canonical' },
  { id: 'content', label_de: 'Inhalte', label_en: 'Content', desc_de: 'H1, Alt-Texte, Wortanzahl, Headings', desc_en: 'H1, alt texts, word count, headings' },
  { id: 'legal', label_de: 'Rechtliches', label_en: 'Legal', desc_de: 'Impressum, DSGVO, Cookie-Banner', desc_en: 'Imprint, GDPR, cookie consent' },
  { id: 'ux', label_de: 'UX & Struktur', label_en: 'UX & Structure', desc_de: 'Navigation, CTAs, Verlinkung', desc_en: 'Navigation, CTAs, linking' },
  { id: 'tech', label_de: 'Technik', label_en: 'Tech', desc_de: 'SSL, DNS, defekte Links, Bildformate', desc_en: 'SSL, DNS, broken links, image formats' },
  { id: 'performance', label_de: 'Performance', label_en: 'Performance', desc_de: 'PageSpeed, Core Web Vitals (braucht Google API Key)', desc_en: 'PageSpeed, Core Web Vitals (needs Google API key)' },
  { id: 'offers', label_de: 'Angebote', label_en: 'Offers', desc_de: 'CTAs, Produktseiten — nur im Claude-Prompt, kein Auto-Check', desc_en: 'CTAs, product pages — Claude prompt only, no auto-check' },
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#a32d2d',
  important: '#854f0b',
  recommended: '#185fa5',
  optional: '#555',
};

const PRIORITY_BG: Record<string, string> = {
  critical: '#fcebeb',
  important: '#faeeda',
  recommended: '#e6f1fb',
  optional: '#f1efe8',
};

function scoreColor(s: number) {
  if (s >= 75) return '#3b6d11';
  if (s >= 50) return '#854f0b';
  return '#a32d2d';
}

function scoreBg(s: number) {
  if (s >= 75) return '#eaf3de';
  if (s >= 50) return '#faeeda';
  return '#fcebeb';
}

export default function AuditApp() {
  const [lang, setLang] = useState<Lang>('de');
  const [url, setUrl] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [hasEnvGoogleKey, setHasEnvGoogleKey] = useState(false);
  const [claudeKey, setClaudeKey] = useState('');
  const [modules, setModules] = useState<Module[]>(ALL_MODULES.map(m => m.id).filter(m => m !== 'offers'));
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'findings' | 'pages' | 'tech' | 'prompt'>('findings');
  const [openFindings, setOpenFindings] = useState<Set<string>>(new Set());
  const [showConfig, setShowConfig] = useState(true);
  const [copied, setCopied] = useState(false);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => {
      if (d.hasGoogleKey) setHasEnvGoogleKey(true);
    }).catch(() => {});
  }, []);

  const isDE = lang === 'de';
  const t = (de: string, en: string) => isDE ? de : en;

  const STAGES = [
    t('Website wird gecrawlt…', 'Crawling website…'),
    t('SEO-Daten werden extrahiert…', 'Extracting SEO data…'),
    t('SSL & DNS werden geprüft…', 'Checking SSL & DNS…'),
    t('Findings werden generiert…', 'Generating findings…'),
    t('Report wird erstellt…', 'Building report…'),
  ];

  function startProgress() {
    let stage = 0;
    setProgress(2);
    setProgressText(STAGES[0]);
    progressInterval.current = setInterval(() => {
      setProgress(p => {
        const next = Math.min(p + Math.random() * 4, 90);
        const newStage = Math.floor((next / 90) * (STAGES.length - 1));
        if (newStage !== stage) { stage = newStage; setProgressText(STAGES[stage]); }
        return next;
      });
    }, 500);
  }

  function stopProgress() {
    if (progressInterval.current) clearInterval(progressInterval.current);
    setProgress(100);
    setProgressText(t('Fertig!', 'Done!'));
  }

  async function runAudit() {
    if (!url.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setShowConfig(false);
    startProgress();

    const config: AuditConfig = {
      url: url.trim(),
      googleApiKey: googleKey.trim() || undefined,
      claudeApiKey: claudeKey.trim() || undefined,
      modules,
      author: 'TW Beckmann Consultancy Services',
      maxPages: 0,
    };


    try {
      const resp = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await resp.json();
      stopProgress();
      if (!resp.ok || data.error) {
        setError(data.error || 'Unknown error');
        setShowConfig(true);
      } else {
        setResult(data);
        setActiveTab('findings');
      }
    } catch (e) {
      stopProgress();
      setError(String(e));
      setShowConfig(true);
    }
    setLoading(false);
  }

  function toggleModule(id: Module) {
    setModules(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  }

  async function downloadPDF(pdfLang: Lang) {
    if (!result) return;
    const { generatePDF } = await import('@/lib/pdf-generator');
    await generatePDF(result, pdfLang);
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
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '2rem 1.5rem', fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 14, color: '#1a1a18' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>SEO Audit Pro</h1>
          <p style={{ color: '#6b6b68', margin: '3px 0 0', fontSize: 13 }}>
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
        <div style={{ background: '#fff', border: '1px solid #e0ddd8', borderRadius: 12, padding: '1.5rem', marginBottom: '1.5rem' }}>

          {/* URL */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>{t('Website URL', 'Website URL')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runAudit()}
                placeholder="https://example.com"
                style={inputStyle}
              />
              <button onClick={runAudit} disabled={loading || !url.trim()} style={primaryBtnStyle}>
                {loading ? t('Läuft…', 'Running…') : t('Audit starten', 'Start audit')}
              </button>
            </div>
          </div>

          {/* Google API Key */}
          {hasEnvGoogleKey ? (
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#eaf3de', borderRadius: 8, border: '1px solid #c0dd97' }}>
              <span style={{ fontSize: 13, color: '#3b6d11' }}>✓</span>
              <span style={{ fontSize: 12, color: '#3b6d11', fontWeight: 500 }}>
                {t('Google API Key aktiv (PageSpeed + Safe Browsing aktiviert)', 'Google API Key active (PageSpeed + Safe Browsing enabled)')}
              </span>
            </div>
          ) : (
            <div style={{ marginBottom: '1rem' }}>
              <label style={labelStyle}>
                Google API Key <span style={{ color: '#9b9b98', fontWeight: 400 }}>({t('optional — für PageSpeed & Safe Browsing', 'optional — for PageSpeed & Safe Browsing')})</span>
              </label>
              <input
                value={googleKey}
                onChange={e => setGoogleKey(e.target.value)}
                placeholder="AIza..."
                type="password"
                style={{ ...inputStyle, maxWidth: 400 }}
              />
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9b9b98' }}>
                {t('Oder in .env.local eintragen: GOOGLE_API_KEY=AIza...', 'Or add to .env.local: GOOGLE_API_KEY=AIza...')}
              </p>
            </div>
          )}

          {/* Claude API Key */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>
              Claude API Key <span style={{ color: '#9b9b98', fontWeight: 400 }}>({t('optional — für automatisierte Content-Analyse', 'optional — for automated content analysis')})</span>
            </label>
            <input
              value={claudeKey}
              onChange={e => setClaudeKey(e.target.value)}
              placeholder="sk-ant-..."
              type="password"
              style={{ ...inputStyle, maxWidth: 400 }}
            />
            <p style={{ margin: '4px 0 0', fontSize: 11, color: '#9b9b98' }}>
              {t('Findet Platzhalter, Widersprüche, Tonalitätsprobleme, Lesbarkeit. Braucht "Inhalte"-Modul.', 'Finds placeholders, contradictions, tone issues, readability. Requires "Content" module.')}
            </p>
          </div>

          {/* Modules */}
          <div>
            <label style={labelStyle}>{t('Module', 'Modules')}</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {ALL_MODULES.map(m => (
                <label key={m.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
                  border: `1px solid ${modules.includes(m.id) ? '#1a1a18' : '#e0ddd8'}`,
                  borderRadius: 8, cursor: 'pointer',
                  background: modules.includes(m.id) ? '#f8f8f6' : '#fff',
                }}>
                  <input type="checkbox" checked={modules.includes(m.id)} onChange={() => toggleModule(m.id)} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{isDE ? m.label_de : m.label_en}</div>
                    <div style={{ fontSize: 11, color: '#9b9b98', marginTop: 1 }}>{isDE ? m.desc_de : m.desc_en}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Progress */}
      {loading && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ height: 4, background: '#e0ddd8', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
            <div style={{ height: '100%', width: `${progress}%`, background: '#ff7a00', borderRadius: 2, transition: 'width 0.4s ease' }} />
          </div>
          <p style={{ fontSize: 12, color: '#6b6b68', margin: 0 }}>{progressText}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ background: '#fcebeb', border: '1px solid #f7c1c1', borderRadius: 8, padding: '12px 16px', marginBottom: '1.5rem', color: '#a32d2d' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Score overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 16, marginBottom: '1.5rem' }}>
            {/* Total score */}
            <div style={{ background: '#fff', border: '1px solid #e0ddd8', borderRadius: 12, padding: '16px 20px', textAlign: 'center', minWidth: 110 }}>
              <div style={{ fontSize: 11, color: '#6b6b68', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                {t('Gesamt', 'Total')}
              </div>
              <div style={{ fontSize: 42, fontWeight: 700, color: scoreColor(result.totalScore), lineHeight: 1 }}>{result.totalScore}</div>
              <div style={{ fontSize: 11, color: '#9b9b98' }}>/100</div>
            </div>

            {/* Module scores */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
              {result.moduleScores.map(ms => (
                <div key={ms.module} style={{ background: scoreBg(ms.score), borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: scoreColor(ms.score) }}>{ms.score}</div>
                  <div style={{ fontSize: 10, color: '#6b6b68', marginTop: 2 }}>{isDE ? ms.label_de : ms.label_en}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Summary */}
          <p style={{ color: '#555', fontSize: 13, lineHeight: 1.7, marginBottom: '1.5rem', padding: '12px 16px', background: '#f8f8f6', borderRadius: 8, borderLeft: '3px solid #e0ddd8' }}>
            {isDE ? result.summary_de : result.summary_en}
          </p>

          {/* Stats row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem', flexWrap: 'wrap' }}>
            {[
              { label: t('Seiten gecrawlt', 'Pages crawled'), value: result.crawlStats.crawledPages },
              { label: t('Findings gesamt', 'Total findings'), value: result.findings.length },
              { label: t('Kritisch', 'Critical'), value: result.findings.filter(f => f.priority === 'critical').length, color: '#a32d2d' },
              { label: t('Wichtig', 'Important'), value: result.findings.filter(f => f.priority === 'important').length, color: '#854f0b' },
              { label: t('Defekte Links', 'Broken links'), value: result.crawlStats.brokenLinks.length, color: result.crawlStats.brokenLinks.length > 0 ? '#a32d2d' : undefined },
            ].map(s => (
              <div key={s.label} style={{ background: '#fff', border: '1px solid #e0ddd8', borderRadius: 8, padding: '8px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: s.color || '#1a1a18' }}>{s.value}</div>
                <div style={{ fontSize: 10, color: '#9b9b98' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: '1rem', borderBottom: '1px solid #e0ddd8' }}>
            {(['findings', 'pages', 'tech', 'prompt'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                padding: '8px 14px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: activeTab === tab ? '2px solid #1a1a18' : '2px solid transparent',
                fontWeight: activeTab === tab ? 600 : 400, color: activeTab === tab ? '#1a1a18' : '#6b6b68',
              }}>
                {tab === 'findings' && t(`Findings (${result.findings.length})`, `Findings (${result.findings.length})`)}
                {tab === 'pages' && t(`Seiten (${result.pages.length})`, `Pages (${result.pages.length})`)}
                {tab === 'tech' && t('SSL & DNS', 'SSL & DNS')}
                {tab === 'prompt' && t('Claude-Prompt', 'Claude Prompt')}
              </button>
            ))}
          </div>

          {/* Findings tab */}
          {activeTab === 'findings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
              {sortedFindings.map(f => {
                const isOpen = openFindings.has(f.id);
                return (
                  <div key={f.id} style={{ background: '#fff', border: '1px solid #e0ddd8', borderRadius: 10, overflow: 'hidden' }}>
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
                      <span style={{ fontSize: 12, color: '#9b9b98' }}>{f.module}</span>
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{isDE ? f.title_de : f.title_en}</span>
                      <span style={{ fontSize: 11, color: '#9b9b98' }}>{isOpen ? '▲' : '▼'}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 14px 14px', borderTop: '1px solid #f0ede8' }}>
                        <div style={{ fontSize: 11, color: '#9b9b98', marginBottom: 6 }}>
                          {t('Aufwand', 'Effort')}: {f.effort} · {t('Impact', 'Impact')}: {f.impact}
                          {f.affectedUrl && <> · <a href={f.affectedUrl} target="_blank" rel="noopener" style={{ color: '#185fa5' }}>{f.affectedUrl}</a></>}
                        </div>
                        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#444', lineHeight: 1.6 }}>
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
              <div style={{ marginTop: '1rem', background: '#eaf3de', border: '1px solid #c0dd97', borderRadius: 10, padding: '14px 16px' }}>
                <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#3b6d11' }}>
                  {t('Was gut ist', "What's Working Well")}
                </h3>
                {(isDE ? result.strengths_de : result.strengths_en).map((s, i) => (
                  <p key={i} style={{ margin: '0 0 4px', fontSize: 12, color: '#27500a' }}>✓ {s}</p>
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
                    <tr style={{ background: '#f8f8f6' }}>
                      {['URL', 'Title', t('Länge', 'Length'), 'H1', 'Schema', t('Wörter', 'Words'), t('Bilder/Alt', 'Img/Alt')].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', border: '1px solid #e0ddd8', fontWeight: 600, color: '#444' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.pages.map((p, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8' }}>
                        <td style={tdStyle}>
                          <a href={p.url} target="_blank" rel="noopener" style={{ color: '#185fa5', fontSize: 11 }}>
                            {p.url.replace(/^https?:\/\/[^/]+/, '') || '/'}
                          </a>
                        </td>
                        <td style={{ ...tdStyle, maxWidth: 180 }}>
                          {p.title
                            ? <span title={p.title}>{p.title.substring(0, 35)}{p.title.length > 35 ? '…' : ''}</span>
                            : <span style={{ color: '#a32d2d', fontWeight: 600 }}>FEHLT</span>
                          }
                        </td>
                        <td style={{ ...tdStyle, color: p.titleLength && (p.titleLength < 30 || p.titleLength > 65) ? '#854f0b' : '#3b6d11' }}>
                          {p.titleLength ?? '—'}
                        </td>
                        <td style={tdStyle}>
                          {p.h1s.length === 1
                            ? <span style={{ color: '#3b6d11' }}>✓</span>
                            : p.h1s.length === 0
                              ? <span style={{ color: '#a32d2d', fontWeight: 600 }}>✗</span>
                              : <span style={{ color: '#854f0b' }}>{p.h1s.length}×</span>
                          }
                        </td>
                        <td style={tdStyle}>{p.schemaTypes.slice(0, 2).join(', ') || <span style={{ color: '#9b9b98' }}>—</span>}</td>
                        <td style={{ ...tdStyle, color: p.wordCount < 300 ? '#854f0b' : '#444' }}>{p.wordCount}</td>
                        <td style={{ ...tdStyle, color: p.imagesMissingAlt > 0 ? '#a32d2d' : '#3b6d11' }}>
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

          {/* Claude Prompt tab */}
          {activeTab === 'prompt' && (
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ background: '#f8f8f6', border: '1px solid #e0ddd8', borderRadius: 10, padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{t('Claude-Prompt für Deep Analysis', 'Claude Prompt for Deep Analysis')}</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b6b68' }}>
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
                  style={{ width: '100%', height: 400, fontSize: 11, fontFamily: 'monospace', border: '1px solid #e0ddd8', borderRadius: 6, padding: '10px', background: '#fff', resize: 'vertical', color: '#333' }}
                />
              </div>
            </div>
          )}

          {/* PDF export */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: '1rem', borderTop: '1px solid #e0ddd8' }}>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f0ede8', fontSize: 12 }}>
      <span style={{ color: '#6b6b68' }}>{label}</span>
      <span style={{ fontWeight: 600, color: ok ? '#3b6d11' : '#a32d2d' }}>{value}</span>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  height: 36, padding: '0 14px', fontSize: 12, fontWeight: 500,
  border: '1px solid #e0ddd8', borderRadius: 8, background: '#fff',
  color: '#1a1a18', cursor: 'pointer',
};

const primaryBtnStyle: React.CSSProperties = {
  ...btnStyle, background: '#1a1a18', color: '#fff', border: '1px solid #1a1a18',
};

const inputStyle: React.CSSProperties = {
  flex: 1, height: 40, padding: '0 12px', fontSize: 14,
  border: '1px solid #e0ddd8', borderRadius: 8, background: '#fff',
  color: '#1a1a18', outline: 'none',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#444',
};

const techCardStyle: React.CSSProperties = {
  background: '#fff', border: '1px solid #e0ddd8', borderRadius: 10, padding: '14px 16px',
};

const techCardTitle: React.CSSProperties = {
  margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: '#1a1a18',
};

const tdStyle: React.CSSProperties = {
  padding: '7px 10px', border: '1px solid #e0ddd8', verticalAlign: 'top',
};
