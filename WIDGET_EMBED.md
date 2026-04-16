# SEO Audit Widget — Einbettungs-Anleitung

Das Widget führt einen Mini-SEO-Audit direkt auf einer Fremd-Website durch
und zeigt Score, Top-3-Handlungsempfehlungen und einen CTA zum vollständigen
Audit auf beckmanndigital.com.

## Schnellstart

Zwei HTML-Snippets, einer für den Container, einer für das Script:

```html
<!-- Platzhalter an der gewünschten Stelle im Content -->
<div id="seo-audit-widget" data-lang="de"></div>

<!-- Script ans Ende des <body> oder ins <head> -->
<script src="https://beckmanndigital.com/seo-audit/widget.js" async></script>
```

Das Script findet automatisch das Container-Element, baut einen iframe und
verdrahtet die dynamische Höhenanpassung via `postMessage`.

## Optionen

| Attribut         | Werte              | Standard | Beschreibung                                       |
|------------------|--------------------|----------|----------------------------------------------------|
| `data-lang`      | `"de"` / `"en"`    | `"de"`   | Widget-Sprache (UI-Texte und API-Language-Flag)    |

## Beispiel: Englisches Widget

```html
<div id="seo-audit-widget" data-lang="en"></div>
<script src="https://beckmanndigital.com/seo-audit/widget.js" async></script>
```

## Technisches

- Das Widget lädt sich als iframe aus `/seo-audit/widget?lang=<code>`.
- Die Audit-API (`/seo-audit/api/widget/audit`) ist per CORS auf
  `https://beckmanndigital.com` beschränkt.
- Rate-Limit: 3 Audits pro IP pro Stunde.
- Mini-Audit umfasst Homepage-Crawl, robots.txt, Sitemap, PageSpeed Insights,
  Security Headers. SSL Labs und Safe Browsing sind bewusst nicht Teil der
  Widget-Variante — zu langsam bzw. erfordern API-Quota.
- Der iframe wächst automatisch mit dem Content (via
  `window.postMessage({type:"seo-audit-resize", height})`), min-Höhe ist
  500px, die Höhe wird bei Werten < 1 oder > 5000 px ignoriert.

## Datenschutz

- Weder Widget noch API setzen Cookies oder Tracking-Pixel.
- Optional gesammelte E-Mail-Adressen (Lead-Capture-Formular) werden
  serverseitig geloggt und manuell bearbeitet — keine automatische
  Weitergabe an Dritte.
- Die zu analysierende URL wird nur im Request-Body an die Audit-API
  übergeben und dort ausschließlich für diesen einen Audit-Lauf verwendet.
