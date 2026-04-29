# SEO Audit Pro v2

Vollständiger, reproduzierbarer SEO-Audit mit PDF-Export in DE + EN.

## Setup

```bash
cd seo-audit-v2
npm install
npm run dev
# → http://localhost:3000
```

### `npm run dev:isolated` — env-isolated dev server

Use when you want to toggle external-API tokens (`GSC_REFRESH_TOKEN`,
`GA4_REFRESH_TOKEN`, `BING_WMT_API_KEY`, `DATAFORSEO_API_KEY`) by
editing `.env.local` and have the change actually take effect. Plain
`npm run dev` inherits the parent shell's environment, so a token that
was once `export`-ed in your shell silently shadows the file even after
you comment it out. `dev:isolated` strips those four vars before
launching Next, so the file is the only source of truth.

## Was geprüft wird

### Automatisch (kein API Key nötig)
- **SEO**: Title, Meta-Description, H1, OG-Tags, Twitter Cards, Canonical, Schema.org, robots.txt, sitemap.xml — auf ALLEN gecrawlten Seiten
- **Content**: Alt-Texte, Heading-Hierarchie, Wortanzahl, Thin Content
- **Legal**: Impressum, Datenschutzerklärung, Cookie-Consent-Banner (CMP-Erkennung)
- **UX**: Viewport, Social Links, interne Verlinkung
- **Tech**: SSL-Zertifikat via SSL Labs, DNS (SPF, DKIM, DMARC, MX), defekte Links, Redirect-Ketten, Bildformate (WebP/AVIF), render-blocking Scripts

### Mit Google API Key (kostenlos, optional)
- **PageSpeed Insights**: echter Performance-Score, LCP, CLS, FID, TBT
- **Google Safe Browsing**: Malware/Phishing-Check

### Via Claude-Prompt (copy-paste in Claude Max)
- Content-Analyse: Widersprüche, Platzhalter, Tonalität, Angebote, CTAs, UX-Qualität
- Tiefe inhaltliche Bewertung die kein automatisches Tool leisten kann

### Optional: JavaScript-Rendering via Browserless
Ohne JS-Rendering werden SPAs (React/Vue/Next/Nuxt mit Client-Routing) als
leere Seiten gecrawlt. Im JS-Modus läuft jede Seite durch ein echtes
Chromium und Findings wie `js-rendering-required` und `js-console-errors`
werden möglich.

```bash
# Token generieren
openssl rand -hex 32

# In zwei .env-Dateien eintragen (gleicher Wert):
# - infra/browserless/.env  (BROWSERLESS_TOKEN=...)
# - .env.local              (BROWSERLESS_TOKEN=...)

# Container starten
cd infra/browserless
cp .env.example .env  # und Token einsetzen
docker compose up -d

# Prüfen, dass /health antwortet
curl "http://localhost:9223/health?token=$(grep ^BROWSERLESS_TOKEN .env | cut -d= -f2)"
# → {"status":"ok"}
```

Im Audit-UI: Rendering-Modus auf "JavaScript (Browserless / Chromium)"
umstellen. Static bleibt der Default.

Cap auf twb-server: MAX_CONCURRENT_SESSIONS=2 (gilt für 8-GiB-Maschine
ohne Swap). Bei höheren Specs in `infra/browserless/docker-compose.yml`
anheben.

## Google API Key erstellen

1. https://console.cloud.google.com
2. Neues Projekt erstellen
3. APIs aktivieren: "PageSpeed Insights API" + "Safe Browsing API"
4. Anmeldedaten → API-Schlüssel erstellen
5. Im Audit-UI eingeben (wird nicht gespeichert)

## Dateien anpassen

- `src/lib/findings-engine.ts` — alle Check-Regeln und Grenzwerte
- `src/lib/external-checks.ts` — API-Integrationen
- `src/lib/claude-prompt.ts` — Prompt-Template für Claude

## Ausgabe

- Interaktives Dashboard mit Findings (aufklappbar), Seiten-Tabelle, SSL/DNS-Kacheln
- Claude-Prompt zum Kopieren
- PDF Deutsch: `[domain]-audit-DE-[datum].pdf`
- PDF Englisch: `[domain]-audit-EN-[datum].pdf`
