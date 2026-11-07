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

## AI visibility (AEO/GEO): module `ai`

How well a site can be read and quoted by AI answers (Google AI Overviews and AI Mode, ChatGPT, Claude, Perplexity). On by default; it replaces the former AI crawler readiness of the SEO module. V1 measures no real citations and uses no paid service. Code: `src/lib/ai-visibility/`.

Seven checks, each with a status (passed, failed, not checkable; llms.txt only a note) and findings in German and English:

1. **AI crawlers in robots.txt** (RFC 9309: product token case-insensitive, groups of one bot combined, `*` group as fallback, longest rule wins, allow wins a tie, `*` and `$`, percent-normalised paths). Only search bots that their vendor documents as honouring robots.txt count for the score; blocking all of them is critical, some of them important. Training bots, user fetchers (ChatGPT-User, Perplexity-User and the like) and undocumented tokens are shown only. "No AI bot named" is no failure. `User-agent: *` with `Disallow: /` stays a finding of the SEO module. Google-Extended controls Gemini training and grounding only; AI Overviews come through Googlebot and its snippet rules.
2. **Snippet controls**: `nosnippet` or `max-snippet:0` (meta robots or googlebot, X-Robots-Tag) is important; `max-snippet` below 50 characters is an optional heuristic (Google names no minimum); `data-nosnippet` (on div, span and section only) over more than half of the main text is recommended.
3. **llms.txt**: present and readable, or not; a note only, never a finding, never in the score.
4. **Structured data for answers**: Organization or LocalBusiness (subtypes count) and WebSite on the start page, Service on service pages, FAQPage where an FAQ is visible, Person on pages about a person and as the author of articles, `sameAs` on Person, `dateModified` on articles; ProfessionalService is deprecated at schema.org. Required and recommended fields and the inner structure of FAQPage (every entry typed Question with a name, its `acceptedAnswer` typed Answer with text) come from `src/lib/schema-fields.ts`, shared with the SEO module, which now also checks Service, the LocalBusiness subtypes and TechArticle (against the fields of Article). Nested Microdata and RDFa items keep their type as `@type`, like nested JSON-LD objects. With the SEO module active, these and JSON-LD parse errors are reported there once.
5. **Readable without JavaScript**: static HTML against the rendered DOM for main text (fails below 50 % of the rendered words), H1 and H2, and the head (title, canonical, hreflang, lang).
6. **Answer friendliness** (heuristic, so marked): question headings with a 15 to 80 word answer paragraph right below, lists and tables, an FAQ section; at most "recommended".
7. **Trust and freshness**: visible author and date on article pages, contact and legal notice linked from the start page, JSON-LD `dateModified` and the `Last-Modified` header against sitemap `lastmod` (more than 30 days apart), all `lastmod` equal (build date instead of change date).

Every shared signal has one owner: with SEO, content, legal or tech active, the AI module refers to their finding instead of adding a second one; a failed check still lowers the AI score.

**Score.** Only checks with the status passed or failed count; without any, the module has no score and stays out of the total. The total score is a weighted mean (every module 1, `ai` 0.5); without `ai` it is the plain mean as before. In the Top 5, AI findings weigh 1.2.

**Crawler data.** `src/lib/ai-visibility/crawlers.json` names each token with its vendor, purpose, what the vendor says about robots.txt, the official source (or none found) and the day it was checked. Keep both up to date when a vendor changes its documentation; `crawlers.test.ts` checks the shape.

**Rendering for check 5.** With Browserless (rendering `js` or `auto`) the crawl's rendered DOM is used. Without it, an optional local Chromium renders the start page and up to four more pages: set `AI_LOCAL_CHROMIUM` to the path of a Chromium executable on the server (nothing is downloaded). That Chromium opens no connection of its own: every request goes through `safe-fetch.ts`:

- the audited host, its www or apex counterpart and, since ultimate-40b, further hosts of the same registrable domain (for `beckmanndigital.com` also `umami.beckmanndigital.com`), at most 10 of them per run;
- the registrable domain comes from the Public Suffix List in `src/lib/ai-visibility/public-suffix-list.json` (both sections, so two projects under `github.io` are two domains); a host no listed rule covers keeps the old rule of host and counterpart;
- every host only with the scheme and port of the audit and only with public addresses, pinned against DNS rebinding; redirects only for the document, each step checked; limits per request and per page;
- the audit's own headers and credentials go to the audited origin only; cookies follow their domain, a `Domain` that is a public suffix is refused.

A page counts only if every one of its requests was served, so pages with resources from other registrable domains cannot be assessed locally; Browserless can. Without either, check 5 is not checkable.

**Public Suffix List.** `node scripts/update-public-suffix-list.mjs` fetches the list and the official test corpus (`src/lib/ai-visibility/__fixtures__/test_psl.txt`), validates both and writes them only if every corpus case passes. It runs by hand, never at runtime. The list is under the MPL 2.0 (https://publicsuffix.org/).

**Deploy.** Nothing to do; `AI_LOCAL_CHROMIUM` is optional.

## Google API Key erstellen

1. https://console.cloud.google.com
2. Neues Projekt erstellen
3. APIs aktivieren: "PageSpeed Insights API" + "Safe Browsing API"
4. Anmeldedaten → API-Schlüssel erstellen
5. Im Audit-UI eingeben (wird nicht gespeichert)

## Dateien anpassen

- `src/lib/findings-engine.ts` — alle Check-Regeln und Grenzwerte
- `src/lib/ai-visibility/`: module KI-Sichtbarkeit (AI visibility) with `crawlers.json`
- `src/lib/external-checks.ts` — API-Integrationen
- `src/lib/claude-prompt.ts` — Prompt-Template für Claude

## Ausgabe

- Interaktives Dashboard mit Findings (aufklappbar), Seiten-Tabelle, SSL/DNS-Kacheln
- Claude-Prompt zum Kopieren
- PDF Deutsch: `[domain]-audit-DE-[datum].pdf`
- PDF Englisch: `[domain]-audit-EN-[datum].pdf`
