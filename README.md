# SEO Audit Pro v2

Vollständiger, reproduzierbarer SEO-Audit mit PDF-Export in DE + EN.

## Setup

```bash
cd seo-audit-v2
npm install
npm run dev
# → http://localhost:3000
```

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
