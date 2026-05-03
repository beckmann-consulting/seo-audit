'use client';

import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditResult, AuditDiff, Lang, Finding } from '@/types';
import { registerInterFont, INTER_FONT_FAMILY } from './pdf-fonts';
import { rateMetric, formatComparator, type MetricKey } from './util/metric-thresholds';
import {
  classifyAIBotRow, classifyLlmsTxt,
  classifyHsts, classifyXContentTypeOptions, classifyXFrameOptions,
  classifyCsp, classifyReferrerPolicy, classifyPermissionsPolicy, classifyMixedContent,
  classifyRedirected, classifyChains, classifyLoops, classifyDowngrades,
  moduleGridLayout, type Severity,
} from './util/severity-classifier';
import { findingImpactScore } from './findings/utils';

// ============================================================
//  Brand palette
// ============================================================
const BRAND_ORANGE: [number, number, number] = [255, 122, 0];
const COLOR_TEXT: [number, number, number] = [26, 26, 26];
const COLOR_SUBTEXT: [number, number, number] = [85, 85, 85];
const COLOR_BORDER: [number, number, number] = [224, 224, 224];
const COLOR_CRITICAL: [number, number, number] = [211, 47, 47];
const COLOR_IMPORTANT: [number, number, number] = [245, 158, 11];
const COLOR_OPTIONAL: [number, number, number] = [136, 136, 136]; // mid-grey — readable but not dominant
const COLOR_GOOD: [number, number, number] = [74, 155, 142]; // #4A9B8E — softer teal-green
const COLOR_INFO: [number, number, number] = [24, 95, 165];  // #185fa5 — matches HTML --info

// Maps the canonical Severity vocabulary (severity-classifier.ts) to
// the PDF's RGB palette so techRow callers can hand in classifier
// output directly without translating per call site.
const SEVERITY_COLOR_RGB: Record<Severity, [number, number, number]> = {
  good:    COLOR_GOOD,
  warn:    COLOR_IMPORTANT,
  bad:     COLOR_CRITICAL,
  info:    COLOR_INFO,
  neutral: COLOR_TEXT,
};

// ============================================================
//  Glyph holes in the embedded font
// ============================================================
// We embed Inter's "latin + latin-ext" subset (~140 KB / weight) instead
// of the full TTF (~330 KB / weight) to keep the lazy-loaded PDF chunk
// inside the agreed bundle budget. That subset covers Basic Latin +
// Latin-1 Supplement + Latin Extended A/B + General Punctuation +
// Currency — everything Western-European audit reports normally need
// EXCEPT a handful of symbol codepoints:
//   ✓ U+2713 / ✗ U+2717  — only in pdf-generator's hard-coded TechRow
//                          values; rendered via vector primitives below.
//   → U+2192             — appears in some finding texts (gsc, bing,
//                          tech, seo). Substituted to ASCII at PDF
//                          render time so the HTML view keeps the
//                          typographic arrow.
//
// The sanitizer is also a defensive guardrail: if a future paste-in (a
// Mac-editor curly char, a stray emoji, anything outside latin+ext) ever
// reaches finding text, the affected codepoint either renders natively
// (Inter has the common typographic chars: ' ' " " — – … € · • all
// covered) or falls through to the silent-drop class of bug that
// triggered Package A. Removing or no-op-ing this function would
// re-introduce that risk for zero runtime gain, so it stays even though
// today only → would actually mojibake.
function sanitizeForPdf(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/≥/g, '>=')   // U+2265 — used in score comparators ("good: ≥90/100")
    .replace(/≤/g, '<=');  // U+2264 — present for symmetry; not in current text
}

// Vector check / cross — anchored on the text baseline at (x, y), scaled
// to roughly match the surrounding 8pt body text. Drawing the symbol as
// strokes (not text) sidesteps both the WinAnsi-encoding bug in jsPDF's
// built-in fonts AND the absence of these codepoints in Inter.
function drawCheckmark(
  doc: jsPDF, x: number, y: number, size: number, color: [number, number, number]
): void {
  doc.setDrawColor(color[0], color[1], color[2]);
  doc.setLineWidth(size * 0.18);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  doc.line(x,                y - size * 0.30, x + size * 0.40, y);
  doc.line(x + size * 0.40,  y,               x + size,         y - size * 0.95);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
}

// drawCrossmark used to back the ✗ symbol in techRow when DNS / SSL
// items failed; with the autoTable-driven Tech Details flow the value
// cell carries an explicit text label ("fehlt", "missing") colored red
// instead. Removed when the helper became unused — keep the comment
// rather than the function so the rationale survives a `git blame`.

// Recommended and optional share the same grey — muted, clearly secondary
const PRIORITY_COLORS: Record<string, [number, number, number]> = {
  critical: COLOR_CRITICAL,
  important: COLOR_IMPORTANT,
  recommended: COLOR_OPTIONAL,
  optional: COLOR_OPTIONAL,
};

// ============================================================
//  Page geometry
// ============================================================
const W = 210; // A4 portrait width
const H = 297; // A4 portrait height
const HEADER_H = 12;
const FOOTER_H = 8;
const CONTENT_TOP = HEADER_H + 6; // 18
const CONTENT_BOTTOM = H - FOOTER_H - 6; // 283
const CONTENT_LEFT = 15;
const CONTENT_RIGHT = 195;
const CONTENT_W = CONTENT_RIGHT - CONTENT_LEFT; // 180

function scoreColorRgb(score: number): [number, number, number] {
  if (score >= 80) return COLOR_GOOD;
  if (score >= 50) return COLOR_IMPORTANT;
  return COLOR_CRITICAL;
}

// Loads /public/TWB_Logo_Transparent.png as a data URL. Runs in the
// browser because this module is 'use client' and pdf-generator is
// dynamically imported from the client-side AuditApp — fs/path are
// not available in that context, so we fetch the static asset.
async function loadLogoDataUrl(): Promise<string | undefined> {
  try {
    const response = await fetch('/TWB_Logo_Transparent.png');
    if (!response.ok) return undefined;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

export async function generatePDF(result: AuditResult, lang: Lang, diff?: AuditDiff | null): Promise<void> {
  const { default: JsPDF } = await import('jspdf');
  const doc = new JsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
  // Embed Inter (Regular + Bold) as a real TTF font so jsPDF treats text
  // as UTF-8. The default Helvetica is WinAnsi-only and silently drops
  // or mojibakes anything outside CP1252 (em-dashes, smart quotes, ✓/✗,
  // umlauts, …). registerInterFont also sets it as the default.
  registerInterFont(doc);

  const isDE = lang === 'de';
  const t = (de: string, en: string) => isDE ? de : en;
  const dateStr = new Date(result.auditedAt).toLocaleDateString(isDE ? 'de-DE' : 'en-GB', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const setFill = (rgb: [number, number, number]) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setText = (rgb: [number, number, number]) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const setDraw = (rgb: [number, number, number]) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

  // ============================================================
  //  Page header — plain white background, black text, no underline
  // ============================================================
  const addPageHeader = () => {
    setText(COLOR_TEXT);
    doc.setFont(INTER_FONT_FAMILY, 'bold');
    doc.setFontSize(9);
    doc.text(t('SEO Audit Report', 'SEO Audit Report'), CONTENT_LEFT, 8);
  };

  // Mutable cursor — helpers advance this in place
  let y = 0;

  const checkPage = (needed: number) => {
    if (y + needed > CONTENT_BOTTOM) {
      doc.addPage();
      addPageHeader();
      y = CONTENT_TOP;
    }
  };

  // H1: bold black title — no underline
  const h1 = (text: string) => {
    checkPage(12);
    setText(COLOR_TEXT);
    doc.setFont(INTER_FONT_FAMILY, 'bold');
    doc.setFontSize(13);
    doc.text(text, CONTENT_LEFT, y + 5);
    y += 10;
  };

  // (techRow + h2 helpers were removed — every tech-details sub-section
  // now flows through renderTechTable below, which renders a bordered
  // header+body table per section. drawCheckmark is still used for the
  // strengths bullets; sanitizeForPdf is shared with finding rendering.)

  // ============================================================
  //  Tech-details table renderer (jspdf-autotable)
  // ============================================================
  // Single helper for every Tech Details sub-section. Each sub-section
  // is rendered as a bordered 2- or 3-column table with the section
  // name as a tinted header row spanning all columns, so the visual
  // relationship between label and value is preserved even when values
  // wrap (long DNS records, multi-token CSP, multiple MX entries).
  //
  // Column 1 is the label (--text-muted, fixed 38mm).
  // Column 2 is the value (severity-colored; monospace when `mono`).
  // Column 3 (optional, present iff any row has a `note`) is the
  // muted right-aligned annotation — used for PSI threshold comparators.
  interface TechTableRow {
    label: string;
    value: string;            // \n is a hard line break inside the cell
    severity?: Severity;      // defaults to neutral (text-strong)
    mono?: boolean;            // value column in built-in Courier
    note?: string;             // adds the right-aligned 3rd column
  }

  const renderTechTable = (title: string, rows: TechTableRow[]) => {
    if (rows.length === 0) return;
    const hasNoteCol = rows.some(r => r.note);

    // Cell type from jspdf-autotable is intentionally loose — use the
    // plugin's documented shape inline rather than the gnarly inferred
    // generic. Each cell is `{ content: string, styles: {...} }`.
    type Cell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
    const body: Cell[][] = rows.map(r => {
      const cells: Cell[] = [
        { content: r.label, styles: { textColor: COLOR_SUBTEXT, fontStyle: 'normal' } },
        {
          content: sanitizeForPdf(r.value),
          styles: {
            font: r.mono ? 'courier' : INTER_FONT_FAMILY,
            textColor: SEVERITY_COLOR_RGB[r.severity ?? 'neutral'],
            fontStyle: r.severity && r.severity !== 'neutral' ? 'bold' : 'normal',
          },
        },
      ];
      if (hasNoteCol) {
        cells.push({
          content: r.note ? sanitizeForPdf(r.note) : '',
          styles: { halign: 'right', fontSize: 7, textColor: COLOR_SUBTEXT, fontStyle: 'normal' },
        });
      }
      return cells;
    });

    // Reserve enough space for the header row + first body row before
    // autoTable takes over its own page-break handling.
    checkPage(14);

    autoTable(doc, {
      startY: y,
      head: [[
        {
          content: title,
          colSpan: hasNoteCol ? 3 : 2,
          styles: {
            fillColor: [245, 245, 243],
            textColor: COLOR_TEXT,
            fontStyle: 'bold',
            fontSize: 9.5,
            cellPadding: { top: 2, right: 3, bottom: 2, left: 3 },
          },
        },
      ]],
      body,
      theme: 'grid',
      margin: { left: CONTENT_LEFT, right: W - CONTENT_RIGHT },
      styles: {
        font: INTER_FONT_FAMILY,
        fontSize: 8,
        cellPadding: { top: 1.6, right: 2.5, bottom: 1.6, left: 2.5 },
        lineColor: COLOR_BORDER,
        lineWidth: 0.2,
        valign: 'top',
        overflow: 'linebreak',
      },
      columnStyles: hasNoteCol
        ? { 0: { cellWidth: 38 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 60 } }
        : { 0: { cellWidth: 38 }, 1: { cellWidth: 'auto' } },
    });

    // Pull the new y cursor from the plugin's lastAutoTable record so
    // subsequent renderTechTable calls stack correctly across pages.
    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;
    y = finalY + 4;
  };

  // ============================================================
  //  Module overview gauges (used on the cover page and nowhere else)
  // ============================================================
  // Adaptive grid via moduleGridLayout — see severity-classifier.ts for
  // the row breakdown rules. Tighter sizing than the previous standalone
  // page block (radius 9, cellH 32) so the whole gauge grid fits below
  // the score block on the cover page.
  const renderModuleOverview = () => {
    if (result.moduleScores.length === 0) return;
    const layout = moduleGridLayout(result.moduleScores.length);
    const gaugeRadius = 9;
    const gaugeGapX = 6;
    const widestRow = Math.max(1, ...layout.rows.map(r => r.length));
    const cellW = (CONTENT_W - gaugeGapX * (widestRow - 1)) / widestRow;
    const cellH = 32;
    const gridTop = y;

    layout.rows.forEach((row, rowIdx) => {
      const rowWidth = row.length * cellW + (row.length - 1) * gaugeGapX;
      const rowIsShort = row.length < widestRow;
      const startX = (layout.centerLast && rowIsShort && rowIdx === layout.rows.length - 1)
        ? CONTENT_LEFT + (CONTENT_W - rowWidth) / 2
        : CONTENT_LEFT;

      row.forEach((moduleIdx, colIdx) => {
        const ms = result.moduleScores[moduleIdx];
        const cellX = startX + colIdx * (cellW + gaugeGapX);
        const cellY = gridTop + rowIdx * cellH;
        const cx = cellX + cellW / 2;
        const cy = cellY + gaugeRadius + 3;

        // Background ring
        setDraw(COLOR_BORDER);
        doc.setLineWidth(2);
        doc.circle(cx, cy, gaugeRadius, 'S');

        // Score arc — clockwise from 12 o'clock
        const mCol = scoreColorRgb(ms.score);
        if (ms.score > 0) {
          setDraw(mCol);
          doc.setLineWidth(2);
          doc.setLineCap('round');
          doc.setLineJoin('round');
          const steps = 60;
          const startAngle = -Math.PI / 2;
          const endAngle = startAngle + (ms.score / 100) * 2 * Math.PI;
          const startX2 = cx + gaugeRadius * Math.cos(startAngle);
          const startY2 = cy + gaugeRadius * Math.sin(startAngle);
          const deltas: [number, number][] = [];
          let prevX = startX2;
          let prevY = startY2;
          for (let i = 1; i <= steps; i++) {
            const a = startAngle + (endAngle - startAngle) * (i / steps);
            const px = cx + gaugeRadius * Math.cos(a);
            const py = cy + gaugeRadius * Math.sin(a);
            deltas.push([px - prevX, py - prevY]);
            prevX = px;
            prevY = py;
          }
          doc.lines(deltas, startX2, startY2, [1, 1], 'S', false);
          doc.setLineCap('butt');
          doc.setLineJoin('miter');
        }

        // Score number centred inside the ring
        setText(COLOR_TEXT);
        doc.setFont(INTER_FONT_FAMILY, 'bold');
        doc.setFontSize(10);
        doc.text(String(ms.score), cx, cy + 1.5, { align: 'center' });

        // Module label below the circle
        setText(COLOR_SUBTEXT);
        doc.setFont(INTER_FONT_FAMILY, 'normal');
        doc.setFontSize(7);
        doc.text(
          isDE ? ms.label_de : ms.label_en,
          cx,
          cellY + gaugeRadius * 2 + 8,
          { align: 'center' }
        );
      });
    });

    y = gridTop + layout.rows.length * cellH + 4;
  };

  // ============================================================
  //  COVER PAGE (page 1) — score + module overview, single A4 sheet
  // ============================================================
  // Logo — top of the page, centred horizontally
  const logoDataUrl = await loadLogoDataUrl();
  if (logoDataUrl) {
    const logoH = 18;
    // Source PNG is 1587x504 → aspect ratio ~3.15
    const logoW = logoH * (1587 / 504);
    doc.addImage(logoDataUrl, 'PNG', (W - logoW) / 2, 20, logoW, logoH);
  }

  // Title in brand orange — shifted up slightly to free vertical room
  // for the module overview at the bottom of the page.
  setText(BRAND_ORANGE);
  doc.setFont(INTER_FONT_FAMILY, 'bold');
  doc.setFontSize(28);
  doc.text(t('SEO AUDIT REPORT', 'SEO AUDIT REPORT'), W / 2, 58, { align: 'center' });

  // URL in primary text colour
  setText(COLOR_TEXT);
  doc.setFont(INTER_FONT_FAMILY, 'normal');
  doc.setFontSize(14);
  doc.text(result.domain, W / 2, 76, { align: 'center' });

  // Date in subtext
  setText(COLOR_SUBTEXT);
  doc.setFontSize(11);
  doc.text(dateStr, W / 2, 88, { align: 'center' });

  // ------------------------------------------------------------
  //  Score — centred, big number + "/100" suffix
  // ------------------------------------------------------------
  // Compressed from y=155 to y=130 to make room for the module overview
  // grid at the bottom of the cover (was on its own page previously).
  const scoreY = 130;
  const mainScoreCol = scoreColorRgb(result.totalScore);

  setText(mainScoreCol);
  doc.setFont(INTER_FONT_FAMILY, 'bold');
  doc.setFontSize(48);
  const scoreStr = String(result.totalScore);
  const scoreTextWidth = doc.getTextWidth(scoreStr);
  const scoreStartX = (W - scoreTextWidth - 22) / 2;
  doc.text(scoreStr, scoreStartX, scoreY);

  setText(COLOR_SUBTEXT);
  doc.setFont(INTER_FONT_FAMILY, 'normal');
  doc.setFontSize(20);
  doc.text('/100', scoreStartX + scoreTextWidth + 2, scoreY);

  // Horizontal score bar (grey track + coloured fill)
  const barY = scoreY + 12;
  const barH = 4;
  setFill(COLOR_BORDER);
  doc.roundedRect(CONTENT_LEFT, barY, CONTENT_W, barH, 2, 2, 'F');
  setFill(mainScoreCol);
  doc.roundedRect(CONTENT_LEFT, barY, (CONTENT_W * result.totalScore) / 100, barH, 2, 2, 'F');

  // Author line
  setText(COLOR_SUBTEXT);
  doc.setFont(INTER_FONT_FAMILY, 'normal');
  doc.setFontSize(10);
  const authorY = barY + 18;
  doc.text(
    t(
      'Erstellt von der TW Beckmann Consultancy Services Ltd.',
      'Created by TW Beckmann Consultancy Services Ltd.'
    ),
    W / 2, authorY, { align: 'center' }
  );

  // Executive summary prose immediately after the score block — short
  // 2-3 line synopsis (totalScore, crawled count, critical/important
  // findings, headline recommendation pointer). Lives on the cover
  // page so the reader gets the verbal context next to the visual.
  y = authorY + 12;
  setText(COLOR_TEXT);
  doc.setFont(INTER_FONT_FAMILY, 'normal');
  doc.setFontSize(9);
  const summaryProse = sanitizeForPdf(isDE ? result.summary_de : result.summary_en);
  const summaryProseLines = doc.splitTextToSize(summaryProse, CONTENT_W);
  doc.text(summaryProseLines, CONTENT_LEFT, y);
  y += summaryProseLines.length * 4.5 + 6;

  // Module overview on the cover. The previous quick-stats row
  // (crawled / findings / critical / important) was redundant with the
  // executive-summary prose above and is gone — the freed vertical
  // space accommodates the module gauges here instead, so the CEO sees
  // score, prose, AND per-module breakdown on page 1.
  setText(COLOR_TEXT);
  doc.setFont(INTER_FONT_FAMILY, 'bold');
  doc.setFontSize(11);
  doc.text(t('Modul-Übersicht', 'Module Overview'), CONTENT_LEFT, y);
  y += 7;
  renderModuleOverview();

  // Cover page footer is drawn by the unified footer loop at the end of
  // the document — no separate cover strip any more.

  // The dedicated "Top 5 Fixes" page that previously lived here was
  // removed — the full Improvement Recommendations list (sorted by
  // priority bucket then findingImpactScore) already serves the same
  // purpose without the redundancy. result.topFindings is still
  // populated by the audit route for the public widget; the Pro PDF
  // simply doesn't render it any more.

  // ============================================================
  //  Diff section — rendered only when a comparison is provided.
  // ============================================================
  if (diff) {
    doc.addPage();
    addPageHeader();
    y = CONTENT_TOP;

    h1(t('Audit-Vergleich', 'Audit Comparison'));

    const previousLabel = (() => {
      try {
        return new Date(diff.previousAuditDate).toLocaleDateString(isDE ? 'de-DE' : 'en-GB', {
          year: 'numeric', month: 'long', day: 'numeric',
        });
      } catch { return diff.previousAuditDate; }
    })();

    setText(COLOR_SUBTEXT);
    doc.setFont(INTER_FONT_FAMILY, 'normal');
    doc.setFontSize(10);
    doc.text(
      t(`${diff.domain} — ${previousLabel} -> heute`, `${diff.domain} — ${previousLabel} -> today`),
      CONTENT_LEFT, y
    );
    y += 10;

    // Score delta prominently
    const deltaCol = diff.scoreDelta > 0 ? COLOR_GOOD : diff.scoreDelta < 0 ? COLOR_CRITICAL : COLOR_SUBTEXT;
    const deltaSign = diff.scoreDelta > 0 ? '+' : '';
    setText(deltaCol);
    doc.setFont(INTER_FONT_FAMILY, 'bold');
    doc.setFontSize(24);
    doc.text(`${deltaSign}${diff.scoreDelta} ${t('Punkte', 'points')}`, CONTENT_LEFT, y);
    setText(COLOR_SUBTEXT);
    doc.setFont(INTER_FONT_FAMILY, 'normal');
    doc.setFontSize(11);
    doc.text(`(${diff.previousAudit.totalScore} -> ${diff.currentAudit.totalScore})`, CONTENT_LEFT + 60, y);
    y += 12;

    const priorityLabelDiff: Record<string, { de: string; en: string }> = {
      critical: { de: 'Kritisch', en: 'Critical' },
      important: { de: 'Wichtig', en: 'Important' },
      recommended: { de: 'Empfohlen', en: 'Recommended' },
      optional: { de: 'Optional', en: 'Optional' },
    };

    const renderDiffFinding = (f: Finding, accent: [number, number, number]) => {
      const title = sanitizeForPdf(isDE ? f.title_de : f.title_en);
      const label = priorityLabelDiff[f.priority][lang];
      const lines = doc.splitTextToSize(title, CONTENT_W - 40);
      const needed = lines.length * 4 + 2;
      checkPage(needed);
      setText(accent);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(7.5);
      doc.text(`${label.toUpperCase()}`, CONTENT_LEFT, y);
      setText(COLOR_SUBTEXT);
      doc.setFont(INTER_FONT_FAMILY, 'normal');
      doc.text(f.module.toUpperCase(), CONTENT_LEFT + 22, y);
      setText(COLOR_TEXT);
      doc.setFontSize(8.5);
      doc.text(lines, CONTENT_LEFT + 40, y);
      y += Math.max(4, lines.length * 4) + 2;
    };

    if (diff.resolved.length > 0) {
      checkPage(10);
      setText(COLOR_GOOD);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(11);
      doc.text(t(`Behoben (${diff.resolved.length})`, `Resolved (${diff.resolved.length})`), CONTENT_LEFT, y);
      y += 6;
      diff.resolved.forEach(f => renderDiffFinding(f, COLOR_GOOD));
      y += 3;
    }

    if (diff.new.length > 0) {
      checkPage(10);
      setText(COLOR_CRITICAL);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(11);
      doc.text(t(`Neu (${diff.new.length})`, `New (${diff.new.length})`), CONTENT_LEFT, y);
      y += 6;
      diff.new.forEach(f => renderDiffFinding(f, COLOR_CRITICAL));
      y += 3;
    }

    if (diff.moduleDeltas.length > 0) {
      checkPage(20);
      setText(COLOR_TEXT);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(11);
      doc.text(t('Modul-Scores', 'Module Scores'), CONTENT_LEFT, y);
      y += 6;

      // Table header
      setText(COLOR_SUBTEXT);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(8);
      doc.text(t('Modul', 'Module'), CONTENT_LEFT + 2, y);
      doc.text(t('Vorher', 'Before'), CONTENT_LEFT + 70, y, { align: 'right' });
      doc.text(t('Nachher', 'After'), CONTENT_LEFT + 105, y, { align: 'right' });
      doc.text('Δ', CONTENT_LEFT + 135, y, { align: 'right' });
      y += 3;
      setDraw(COLOR_BORDER);
      doc.setLineWidth(0.2);
      doc.line(CONTENT_LEFT, y, CONTENT_RIGHT, y);
      y += 3;

      diff.moduleDeltas.forEach(md => {
        checkPage(6);
        const prev = diff.previousAudit.moduleScores.find(m => m.module === md.module)?.score ?? 0;
        const curr = diff.currentAudit.moduleScores.find(m => m.module === md.module)?.score ?? 0;
        const dColor = md.delta > 0 ? COLOR_GOOD : md.delta < 0 ? COLOR_CRITICAL : COLOR_SUBTEXT;
        const dSign = md.delta > 0 ? '+' : '';
        setText(COLOR_TEXT);
        doc.setFont(INTER_FONT_FAMILY, 'normal');
        doc.setFontSize(8.5);
        doc.text(md.module.toUpperCase(), CONTENT_LEFT + 2, y);
        doc.text(String(prev), CONTENT_LEFT + 70, y, { align: 'right' });
        doc.text(String(curr), CONTENT_LEFT + 105, y, { align: 'right' });
        setText(dColor);
        doc.setFont(INTER_FONT_FAMILY, 'bold');
        doc.text(`${dSign}${md.delta}`, CONTENT_LEFT + 135, y, { align: 'right' });
        y += 5;
        setDraw(COLOR_BORDER);
        doc.line(CONTENT_LEFT, y - 1, CONTENT_RIGHT, y - 1);
      });
    }
  }

  // ============================================================
  //  Findings — first content page after the cover
  // ============================================================
  // Executive summary prose now lives on the cover (above the module
  // overview); this page goes straight into Improvement Recommendations.
  doc.addPage();
  addPageHeader();
  y = CONTENT_TOP;

  h1(t('Verbesserungsempfehlungen', 'Improvement Recommendations'));

  // Two-key sort: priority bucket primary (critical → optional), then
  // findingImpactScore descending within each bucket so the most
  // impactful items in a bucket surface first. Identical to the HTML
  // findings tab in AuditApp.tsx — keep them in sync.
  const priorityOrder = { critical: 0, important: 1, recommended: 2, optional: 3 };
  const sortedFindings = [...result.findings].sort((a, b) => {
    const pdiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pdiff !== 0) return pdiff;
    return findingImpactScore(b) - findingImpactScore(a);
  });
  const priorityLabels: Record<string, { de: string; en: string }> = {
    critical: { de: 'Kritisch', en: 'Critical' },
    important: { de: 'Wichtig', en: 'Important' },
    recommended: { de: 'Empfohlen', en: 'Recommended' },
    optional: { de: 'Optional', en: 'Optional' },
  };

  const renderFinding = (f: Finding) => {
    const title = sanitizeForPdf(isDE ? f.title_de : f.title_en);
    const desc = sanitizeForPdf(isDE ? f.description_de : f.description_en);
    const rec = sanitizeForPdf(isDE ? f.recommendation_de : f.recommendation_en);
    const col = PRIORITY_COLORS[f.priority];
    const label = priorityLabels[f.priority][lang];

    // Inner padding for the card border. No leading severity dot any more,
    // so content starts at pad + small text indent with no reserved icon space.
    const pad = 4;
    const cardInnerLeft = CONTENT_LEFT + pad;
    const cardInnerW = CONTENT_W - pad * 2;
    const titleLines = doc.splitTextToSize(title, cardInnerW);
    const descLinesAll = doc.splitTextToSize(desc, cardInnerW);
    const descLines = descLinesAll.slice(0, 2); // cap at 2 lines per spec
    const recLines = doc.splitTextToSize(rec, cardInnerW - 12);

    const cardHeight =
      pad +
      6.5 /* severity label row — gap to title */ +
      titleLines.length * 4.5 + 0.5 +
      descLines.length * 4 + 4.5 /* gap before todo */ +
      Math.max(4, recLines.length * 4) +
      pad;

    checkPage(cardHeight + 5);
    const cardTop = y;

    // Severity label — text-only in the severity colour, no dot
    const labelY = cardTop + pad + 2;
    setText(col);
    doc.setFont(INTER_FONT_FAMILY, 'bold');
    doc.setFontSize(7.5);
    doc.text(`${label.toUpperCase()} · ${f.module.toUpperCase()}`, cardInnerLeft, labelY);
    let cursor = cardTop + pad + 6.5;

    // Title
    setText(COLOR_TEXT);
    doc.setFont(INTER_FONT_FAMILY, 'bold');
    doc.setFontSize(9);
    doc.text(titleLines, cardInnerLeft, cursor);
    cursor += titleLines.length * 4.5 + 0.5;

    // Description (subtext, max 2 lines)
    setText(COLOR_SUBTEXT);
    doc.setFont(INTER_FONT_FAMILY, 'normal');
    doc.setFontSize(8);
    doc.text(descLines, cardInnerLeft, cursor + 1);
    cursor += descLines.length * 4 + 4.5;

    // Todo line — bold "Todo:" label then recommendation with indent
    setText(COLOR_TEXT);
    doc.setFont(INTER_FONT_FAMILY, 'bold');
    doc.setFontSize(8);
    doc.text(t('Todo:', 'Todo:'), cardInnerLeft, cursor);
    doc.setFont(INTER_FONT_FAMILY, 'normal');
    doc.text(recLines, cardInnerLeft + 12, cursor);
    cursor += Math.max(4, recLines.length * 4);

    // Grey card border enclosing the full card height (jsPDF roundedRect
    // with style 'S' strokes without filling — border radius in mm)
    const actualHeight = cursor + pad - cardTop;
    setDraw(COLOR_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(CONTENT_LEFT, cardTop, CONTENT_W, actualHeight, 1, 1, 'S');

    y = cardTop + actualHeight + 4;
  };

  sortedFindings.forEach(renderFinding);

  // ============================================================
  //  Strengths
  // ============================================================
  y += 4;
  h1(t('Was gut ist', "What's Working Well"));

  const strengths = isDE ? result.strengths_de : result.strengths_en;
  for (const s of strengths) {
    checkPage(7);
    drawCheckmark(doc, CONTENT_LEFT, y, 3.4, COLOR_GOOD);
    setText(COLOR_TEXT);
    doc.setFont(INTER_FONT_FAMILY, 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(sanitizeForPdf(s), CONTENT_W - 8);
    doc.text(lines, CONTENT_LEFT + 6, y);
    y += lines.length * 4.5 + 1.5;
  }

  // ============================================================
  //  Technical Details (all tech-data blocks)
  // ============================================================
  const hasAnyTechData =
    result.sslInfo || result.dnsInfo || result.pageSpeedData ||
    result.securityHeaders || result.aiReadiness || result.sitemapInfo ||
    result.safeBrowsingData;

  if (hasAnyTechData) {
    y += 4;
    h1(t('Technische Details', 'Technical Details'));

    // SSL / TLS
    if (result.sslInfo) {
      const ssl = result.sslInfo;
      const grade = ssl.grade || '';
      const gradeSeverity: Severity = ssl.pendingSlow ? 'neutral'
        : !ssl.valid ? 'bad'
        : ['A+', 'A', 'A-'].includes(grade) ? 'good'
        : grade ? 'warn'
        : 'neutral';
      const sslRows: TechTableRow[] = [
        { label: t('Grade', 'Grade'), value: ssl.grade || t('unbekannt', 'unknown'), severity: gradeSeverity },
        { label: t('Gültig', 'Valid'), value: ssl.valid ? t('Ja', 'Yes') : t('Nein', 'No'), severity: ssl.valid ? 'good' : 'bad' },
      ];
      if (ssl.daysUntilExpiry !== undefined) {
        sslRows.push({
          label: t('Läuft ab in', 'Expires in'),
          value: `${ssl.daysUntilExpiry} ${t('Tagen', 'days')}`,
          severity: ssl.daysUntilExpiry < 14 ? 'bad' : ssl.daysUntilExpiry < 30 ? 'warn' : 'good',
        });
      }
      if (ssl.issuer) sslRows.push({ label: t('Aussteller', 'Issuer'), value: ssl.issuer });
      if (ssl.protocols && ssl.protocols.length > 0) {
        sslRows.push({ label: t('Protokolle', 'Protocols'), value: ssl.protocols.join(', ') });
      }
      renderTechTable(t('SSL / TLS', 'SSL / TLS'), sslRows);
    }

    // DNS & Email
    if (result.dnsInfo) {
      const dns = result.dnsInfo;
      const hasMx = !!(dns.mxRecords && dns.mxRecords.length > 0);
      // Without MX the domain isn't sending mail — SPF/DMARC missing is
      // only a warning then, not bad. Mirrors AuditApp.tsx logic.
      const missingMailSev: Severity = hasMx ? 'bad' : 'warn';
      const dnsRows: TechTableRow[] = [
        {
          label: 'SPF',
          value: dns.hasSPF && dns.spfRecord ? dns.spfRecord : t('fehlt', 'missing'),
          mono: dns.hasSPF,
          severity: dns.hasSPF ? 'good' : missingMailSev,
        },
        {
          label: 'DKIM',
          value: dns.hasDKIM && dns.dkimRecord
            ? (dns.dkimSelector ? `selector: ${dns.dkimSelector}\n${dns.dkimRecord}` : dns.dkimRecord)
            : t('nicht verifizierbar', 'not verifiable'),
          mono: dns.hasDKIM,
          severity: dns.hasDKIM ? 'good' : 'neutral',
        },
        {
          label: 'DMARC',
          value: dns.hasDMARC && dns.dmarcRecord ? dns.dmarcRecord : t('fehlt', 'missing'),
          mono: dns.hasDMARC,
          severity: dns.hasDMARC ? 'good' : missingMailSev,
        },
      ];
      if (hasMx) {
        dnsRows.push({ label: 'MX', value: dns.mxRecords!.join('\n'), mono: true });
      }
      renderTechTable(t('DNS & E-Mail', 'DNS & Email'), dnsRows);
    }

    // PageSpeed — comparator note in column 3, severity colors the value.
    if (result.pageSpeedData && !result.pageSpeedData.error) {
      const ps = result.pageSpeedData;
      const locale: 'de' | 'en' = isDE ? 'de' : 'en';
      const psiSeverity = (rating: ReturnType<typeof rateMetric>): Severity =>
        rating === 'good' ? 'good' : rating === 'poor' ? 'bad' : 'warn';
      const psiRows: TechTableRow[] = [];
      const pushPsi = (label: string, raw: number, key: MetricKey, display: string) => {
        psiRows.push({
          label,
          value: display,
          severity: psiSeverity(rateMetric(raw, key)),
          note: formatComparator(key, locale),
        });
      };
      if (ps.performanceScore !== undefined) pushPsi('Performance', ps.performanceScore, 'score', `${ps.performanceScore}/100`);
      if (ps.seoScore !== undefined) pushPsi('SEO', ps.seoScore, 'score', `${ps.seoScore}/100`);
      if (ps.accessibilityScore !== undefined) pushPsi(t('Zugänglichkeit', 'Accessibility'), ps.accessibilityScore, 'score', `${ps.accessibilityScore}/100`);
      if (ps.bestPracticesScore !== undefined) pushPsi(t('Best Practices', 'Best Practices'), ps.bestPracticesScore, 'score', `${ps.bestPracticesScore}/100`);
      if (ps.lcp !== undefined) pushPsi('LCP', ps.lcp, 'lcp', `${Math.round(ps.lcp / 100) / 10}s`);
      if (ps.cls !== undefined) pushPsi('CLS', ps.cls, 'cls', ps.cls.toFixed(3));
      if (ps.inp !== undefined) pushPsi('INP', ps.inp, 'inp', `${Math.round(ps.inp)}ms`);
      // FID: legacy metric INP replaced in March 2024. No web.dev
      // comparator any more; falls back to the historical 100ms cutoff.
      if (ps.fidField !== undefined) {
        psiRows.push({
          label: t('FID (Feld)', 'FID (field)'),
          value: `${Math.round(ps.fidField)}ms`,
          severity: ps.fidField < 100 ? 'good' : 'warn',
        });
      }
      if (ps.fcp !== undefined) pushPsi('FCP', ps.fcp, 'fcp', `${Math.round(ps.fcp / 100) / 10}s`);
      if (ps.ttfb !== undefined) pushPsi('TTFB', ps.ttfb, 'ttfb', `${Math.round(ps.ttfb)}ms`);
      if (ps.tbt !== undefined) pushPsi('TBT', ps.tbt, 'tbt', `${Math.round(ps.tbt)}ms`);
      renderTechTable(t('PageSpeed (Mobile) & Core Web Vitals', 'PageSpeed (Mobile) & Core Web Vitals'), psiRows);
    }

    // Security Headers — classifier-driven per-header severity.
    if (result.securityHeaders && !result.securityHeaders.error) {
      const sh = result.securityHeaders;
      const frameViaCsp = /frame-ancestors/i.test(sh.csp || '');
      const shRows: TechTableRow[] = [
        {
          label: 'HSTS',
          value: sh.hsts ? (sh.hstsMaxAge ? `max-age=${sh.hstsMaxAge}` : t('gesetzt', 'set')) : t('fehlt', 'missing'),
          mono: !!sh.hsts,
          severity: classifyHsts(sh),
        },
        {
          label: 'X-Content-Type-Options',
          value: sh.xContentTypeOptions || t('fehlt', 'missing'),
          mono: !!sh.xContentTypeOptions,
          severity: classifyXContentTypeOptions(sh),
        },
        {
          label: 'X-Frame-Options',
          value: sh.xFrameOptions || (frameViaCsp ? t('via CSP', 'via CSP') : t('fehlt', 'missing')),
          mono: !!sh.xFrameOptions,
          severity: classifyXFrameOptions(sh),
        },
        {
          label: 'CSP',
          value: sh.csp || t('fehlt', 'missing'),
          mono: !!sh.csp,
          severity: classifyCsp(sh),
        },
        {
          label: 'Referrer-Policy',
          value: sh.referrerPolicy || t('fehlt', 'missing'),
          mono: !!sh.referrerPolicy,
          severity: classifyReferrerPolicy(sh),
        },
        {
          label: 'Permissions-Policy',
          value: sh.permissionsPolicy || t('fehlt', 'missing'),
          mono: !!sh.permissionsPolicy,
          severity: classifyPermissionsPolicy(sh),
        },
      ];
      if (sh.hasCookieSecure === false) {
        shRows.push({ label: t('Cookie Secure-Flag', 'Cookie Secure flag'), value: t('fehlt', 'missing'), severity: 'warn' });
      }
      if (sh.hasMixedContent) {
        shRows.push({ label: 'Mixed Content', value: t('erkannt', 'detected'), severity: classifyMixedContent(true) });
      }
      renderTechTable(t('Security Headers', 'Security Headers'), shRows);
    }

    // AI Crawler Readiness — unspecified rendered neutral; llms.txt
    // missing is info-blue (emerging standard, ~10% adoption).
    if (result.aiReadiness && !result.aiReadiness.error) {
      const ai = result.aiReadiness;
      const aiRows: TechTableRow[] = [
        {
          label: 'llms.txt',
          value: ai.hasLlmsTxt ? t('vorhanden', 'present') : t('nicht konfiguriert (optional)', 'not configured (optional)'),
          severity: classifyLlmsTxt(ai.hasLlmsTxt),
        },
        {
          label: 'llms-full.txt',
          value: ai.hasLlmsFullTxt ? t('vorhanden', 'present') : t('nicht konfiguriert (optional)', 'not configured (optional)'),
          severity: classifyLlmsTxt(ai.hasLlmsFullTxt),
        },
      ];
      for (const b of ai.bots) {
        const valueText = b.status === 'allowed' ? t('erlaubt', 'allowed')
          : b.status === 'blocked' ? t('blockiert', 'blocked')
          : b.status === 'partial' ? t('teilweise', 'partial')
          : t('nicht geregelt', 'unspecified');
        aiRows.push({ label: `${b.bot} (${b.purpose})`, value: valueText, severity: classifyAIBotRow(b.status) });
      }
      renderTechTable(t('AI Crawler Readiness', 'AI Crawler Readiness'), aiRows);
    }

    // Sitemap Coverage
    if (result.sitemapInfo && !result.sitemapInfo.error) {
      const sm = result.sitemapInfo;
      const smRows: TechTableRow[] = [
        { label: t('URLs in Sitemap', 'URLs in sitemap'), value: String(sm.urls.length) },
        { label: t('Sitemap-Index', 'Sitemap index'), value: sm.isIndex ? t('ja', 'yes') : t('nein', 'no') },
      ];
      if (sm.isIndex) {
        smRows.push({ label: t('Sub-Sitemaps', 'Sub-sitemaps'), value: String(sm.subSitemaps.length) });
      }
      const withLastmod = sm.urls.filter(e => !!e.lastmod).length;
      smRows.push({
        label: t('Mit lastmod', 'With lastmod'),
        value: `${withLastmod}/${sm.urls.length}`,
        severity: withLastmod > 0 ? 'good' : 'warn',
      });
      const withImages = sm.urls.filter(e => e.imageCount > 0).length;
      smRows.push({ label: t('Mit Bild-Einträgen', 'With image entries'), value: String(withImages) });

      const crawledSet = new Set(result.pages.map(p => p.url));
      const sitemapSet = new Set(sm.urls.map(e => e.url));
      const missingFromCrawl = [...sitemapSet].filter(u => !crawledSet.has(u)).length;
      const missingFromSitemap = [...crawledSet].filter(u => !sitemapSet.has(u)).length;
      smRows.push({
        label: t('In Sitemap, nicht gecrawlt', 'In sitemap, not crawled'),
        value: String(missingFromCrawl),
        severity: missingFromCrawl === 0 ? 'good' : 'warn',
      });
      smRows.push({
        label: t('Gecrawlt, nicht in Sitemap', 'Crawled, not in sitemap'),
        value: String(missingFromSitemap),
        severity: missingFromSitemap === 0 ? 'good' : 'warn',
      });
      renderTechTable(t('Sitemap Coverage', 'Sitemap Coverage'), smRows);
    }

    // Redirects
    const redirected = result.pages.filter(p => p.redirectChain && p.redirectChain.length > 0);
    const chainPages = redirected.filter(p => p.redirectChain.length > 1);
    const loopPages = redirected.filter(p => {
      const seen = new Set<string>();
      for (const hop of p.redirectChain) {
        if (seen.has(hop)) return true;
        seen.add(hop);
      }
      return p.redirectChain.includes(p.finalUrl);
    });
    const downgradePages = redirected.filter(p =>
      p.redirectChain[0]?.startsWith('https://') && p.finalUrl.startsWith('http://')
    );
    if (redirected.length > 0 || result.crawlStats.redirectChains.length > 0) {
      const redirectInputs = {
        redirectedCount: redirected.length,
        chainCount: chainPages.length,
        loopCount: loopPages.length,
        downgradeCount: downgradePages.length,
      };
      renderTechTable(t('Redirects', 'Redirects'), [
        { label: t('Mit Redirect gecrawlt', 'Crawled via redirect'), value: String(redirected.length), severity: classifyRedirected(redirectInputs) },
        { label: t('Ketten (>1 Hop)', 'Chains (>1 hop)'), value: String(chainPages.length), severity: classifyChains(chainPages.length) },
        { label: t('Schleifen', 'Loops'), value: String(loopPages.length), severity: classifyLoops(loopPages.length) },
        { label: 'HTTPS -> HTTP', value: String(downgradePages.length), severity: classifyDowngrades(downgradePages.length) },
      ]);
    }

    // Link Quality
    const totalGeneric = result.pages.reduce((s, p) => s + (p.genericAnchors?.length || 0), 0);
    const totalEmpty = result.pages.reduce((s, p) => s + (p.emptyAnchors || 0), 0);
    const noindexPages = result.pages.filter(p => p.hasNoindex).length;
    if (totalGeneric > 0 || totalEmpty > 0 || noindexPages > 0) {
      renderTechTable(t('Link Quality', 'Link Quality'), [
        { label: t('Generische Ankertexte', 'Generic anchor texts'), value: String(totalGeneric), severity: totalGeneric === 0 ? 'good' : 'warn' },
        { label: t('Links ohne Text', 'Links without text'), value: String(totalEmpty), severity: totalEmpty === 0 ? 'good' : 'warn' },
        { label: t('Seiten mit noindex', 'Pages with noindex'), value: String(noindexPages) },
      ]);
    }

    // Safe Browsing
    if (result.safeBrowsingData) {
      const sbRows: TechTableRow[] = [
        {
          label: t('Status', 'Status'),
          value: result.safeBrowsingData.isSafe ? t('Sicher', 'Safe') : t('GEFÄHRLICH', 'DANGEROUS'),
          severity: result.safeBrowsingData.isSafe ? 'good' : 'bad',
        },
      ];
      if (result.safeBrowsingData.threats && result.safeBrowsingData.threats.length > 0) {
        sbRows.push({
          label: t('Bedrohungen', 'Threats'),
          value: result.safeBrowsingData.threats.join(', '),
          severity: 'bad',
        });
      }
      renderTechTable(t('Google Safe Browsing', 'Google Safe Browsing'), sbRows);
    }

    // Crawl Statistics
    renderTechTable(t('Crawl-Statistik', 'Crawl Statistics'), [
      { label: t('Seiten gecrawlt', 'Pages crawled'), value: String(result.crawlStats.crawledPages) },
      { label: t('Defekte Links', 'Broken links'), value: String(result.crawlStats.brokenLinks.length), severity: result.crawlStats.brokenLinks.length === 0 ? 'good' : 'bad' },
      { label: t('Weiterleitungen', 'Redirects'), value: String(result.crawlStats.redirectChains.length), severity: result.crawlStats.redirectChains.length < 3 ? 'good' : 'warn' },
      { label: t('Externe Links', 'External links'), value: String(result.crawlStats.externalLinks) },
    ]);
    y += 4;
  }

  // ============================================================
  //  Page-by-page appendix
  // ============================================================
  if (result.pages.length > 1) {
    y += 4;
    h1(t('Seitenanalyse', 'Page Analysis'));

    result.pages.forEach((p, i) => {
      checkPage(30);
      setText(COLOR_TEXT);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(8.5);
      const urlLines = doc.splitTextToSize(`${i + 1}. ${p.url}`, CONTENT_W);
      doc.text(urlLines, CONTENT_LEFT, y);
      y += urlLines.length * 4.5;

      const rows: [string, string][] = [
        [t('Title', 'Title'), p.title ? `"${p.title}" (${p.titleLength} ${t('Zeichen', 'chars')})` : t('FEHLT', 'MISSING')],
        [t('Meta Description', 'Meta Description'), p.metaDescription ? `${p.metaDescriptionLength} ${t('Zeichen', 'chars')}` : t('FEHLT', 'MISSING')],
        ['H1', p.h1s.length > 0 ? `"${p.h1s[0].substring(0, 60)}"${p.h1s.length > 1 ? ` (+${p.h1s.length - 1})` : ''}` : t('FEHLT', 'MISSING')],
        [t('Schema', 'Schema'), p.schemaTypes.length > 0 ? p.schemaTypes.join(', ') : t('keines', 'none')],
        [t('Wörter', 'Words'), String(p.wordCount)],
        [t('Bilder ohne Alt', 'Images missing alt'), `${p.imagesMissingAlt}/${p.totalImages}`],
        [t('Klicktiefe', 'Click depth'), String(p.depth)],
      ];

      if (p.inlinkCount !== undefined) {
        rows.push([t('Interne Inlinks', 'Internal inlinks'), String(p.inlinkCount)]);
      }
      if (p.hasNoindex) rows.push([t('Robots', 'Robots'), 'noindex']);
      if (p.redirectChain && p.redirectChain.length > 0) {
        const chainStr = p.redirectChain.concat(p.finalUrl).join(' -> ');
        rows.push([t('Redirect-Kette', 'Redirect chain'), chainStr.length > 120 ? chainStr.slice(0, 120) + '…' : chainStr]);
      }
      if (p.genericAnchors && p.genericAnchors.length > 0) {
        rows.push([
          t('Generische Anker', 'Generic anchors'),
          `${p.genericAnchors.length} (${p.genericAnchors.slice(0, 2).map(a => `"${a.text}"`).join(', ')}${p.genericAnchors.length > 2 ? '...' : ''})`,
        ]);
      }
      if (p.hreflangs && p.hreflangs.length > 0) {
        rows.push(['Hreflang', p.hreflangs.map(h => h.hreflang).join(', ')]);
      }
      if (p.likelyClientRendered) {
        rows.push([t('JS-Rendering', 'JS rendering'), p.clientRenderSignal || t('clientseitig gerendert', 'client-side rendered')]);
      }

      rows.forEach(([label, value]) => {
        checkPage(5);
        setText(COLOR_SUBTEXT);
        doc.setFont(INTER_FONT_FAMILY, 'normal');
        doc.setFontSize(8);
        doc.text(label + ':', CONTENT_LEFT + 2, y);
        setText(COLOR_TEXT);
        const valueLines = doc.splitTextToSize(sanitizeForPdf(value), CONTENT_W - 45);
        doc.text(valueLines, CONTENT_LEFT + 40, y);
        y += valueLines.length * 4 + 0.8;
      });
      y += 2;
      setDraw(COLOR_BORDER);
      doc.setLineWidth(0.2);
      doc.line(CONTENT_LEFT, y, CONTENT_RIGHT, y);
      y += 4;
    });
  }

  // ============================================================
  //  Screenshots (only when JS-mode captured them)
  // ============================================================
  if (result.screenshots && result.screenshots.length > 0) {
    h1(t('Screenshots', 'Screenshots'));
    // Mobile (50mm × 89mm — preserves the 375:667 aspect of an iPhone
    // SE viewport) and Desktop (110mm × 62mm — 1920:1080) side by side
    // with a 10mm gutter, totalling 170mm of the 180mm content width.
    const MOBILE_W = 50, MOBILE_H = 89;
    const DESKTOP_W = 110, DESKTOP_H = 62;
    const ROW_GAP = 6;
    const ROW_HEIGHT = Math.max(MOBILE_H, DESKTOP_H) + 12; // image area + caption + spacing

    for (const shot of result.screenshots) {
      checkPage(ROW_HEIGHT + 5);
      setText(COLOR_TEXT);
      doc.setFont(INTER_FONT_FAMILY, 'bold');
      doc.setFontSize(10);
      const urlLines = doc.splitTextToSize(shot.url, CONTENT_W);
      doc.text(urlLines.slice(0, 1), CONTENT_LEFT, y + 4);
      y += 7;

      const imgY = y;
      if (shot.mobileBase64) {
        try {
          doc.addImage(
            'data:image/png;base64,' + shot.mobileBase64,
            'PNG', CONTENT_LEFT, imgY, MOBILE_W, MOBILE_H,
          );
          setText(COLOR_SUBTEXT);
          doc.setFont(INTER_FONT_FAMILY, 'normal');
          doc.setFontSize(8);
          doc.text(t('Mobile · 375×667', 'Mobile · 375×667'), CONTENT_LEFT, imgY + MOBILE_H + 4);
        } catch { /* malformed PNG — skip silently */ }
      }
      if (shot.desktopBase64) {
        try {
          const dx = CONTENT_LEFT + MOBILE_W + ROW_GAP;
          doc.addImage(
            'data:image/png;base64,' + shot.desktopBase64,
            'PNG', dx, imgY, DESKTOP_W, DESKTOP_H,
          );
          setText(COLOR_SUBTEXT);
          doc.setFont(INTER_FONT_FAMILY, 'normal');
          doc.setFontSize(8);
          doc.text(t('Desktop · 1920×1080', 'Desktop · 1920×1080'), dx, imgY + DESKTOP_H + 4);
        } catch { /* malformed PNG — skip silently */ }
      }
      y = imgY + Math.max(MOBILE_H, DESKTOP_H) + 10;
    }
  }

  // ============================================================
  //  Footers — unified across every page including the cover.
  //  White background, thin grey top line, centred muted text.
  // ============================================================
  const totalPages = doc.internal.pages.length - 1; // jsPDF pages array is 1-indexed with a leading null
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    setDraw(COLOR_BORDER);
    doc.setLineWidth(0.35);
    doc.line(CONTENT_LEFT, H - FOOTER_H, CONTENT_RIGHT, H - FOOTER_H);
    setText(COLOR_SUBTEXT);
    doc.setFont(INTER_FONT_FAMILY, 'normal');
    doc.setFontSize(8);
    doc.text(
      `beckmanndigital.com · TW Beckmann Consultancy Services Ltd. · ${dateStr} · ${t('Seite', 'Page')} ${i}/${totalPages}`,
      W / 2, H - FOOTER_H + 5, { align: 'center' }
    );
  }

  const filename = `${result.domain}-audit-${lang.toUpperCase()}-${new Date(result.auditedAt).toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
