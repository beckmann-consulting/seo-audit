'use client';

import type { AuditResult, AuditDiff, Lang, Finding } from '@/types';

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
    doc.setFont('helvetica', 'bold');
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(text, CONTENT_LEFT, y + 5);
    y += 10;
  };

  // H2: bold black sub-heading — no underline
  const h2 = (text: string) => {
    checkPage(9);
    y += 2;
    setText(COLOR_TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(text, CONTENT_LEFT, y + 3);
    y += 7;
  };

  // Tech row: grey label + value, red when ok === false
  const techRow = (label: string, value: string, ok: boolean = true) => {
    checkPage(5);
    setText(COLOR_SUBTEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(label, CONTENT_LEFT + 2, y);
    setText(ok ? COLOR_TEXT : COLOR_CRITICAL);
    const valueLines = doc.splitTextToSize(value, CONTENT_W - 65);
    doc.text(valueLines, CONTENT_LEFT + 60, y);
    y += valueLines.length * 4 + 0.8;
  };

  // ============================================================
  //  COVER PAGE (page 1) — white background, accents only
  // ============================================================
  // Logo — top of the page, centred horizontally
  const logoDataUrl = await loadLogoDataUrl();
  if (logoDataUrl) {
    const logoH = 18;
    // Source PNG is 1587x504 → aspect ratio ~3.15
    const logoW = logoH * (1587 / 504);
    doc.addImage(logoDataUrl, 'PNG', (W - logoW) / 2, 20, logoW, logoH);
  }

  // Title in brand orange — shifted down so it never overlaps the logo
  setText(BRAND_ORANGE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text(t('SEO AUDIT REPORT', 'SEO AUDIT REPORT'), W / 2, 62, { align: 'center' });

  // URL in primary text colour
  setText(COLOR_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text(result.domain, W / 2, 80, { align: 'center' });

  // Date in subtext
  setText(COLOR_SUBTEXT);
  doc.setFontSize(11);
  doc.text(dateStr, W / 2, 92, { align: 'center' });

  // ------------------------------------------------------------
  //  Score — centred, big number + "/100" suffix
  // ------------------------------------------------------------
  const scoreY = 155;
  const mainScoreCol = scoreColorRgb(result.totalScore);

  setText(mainScoreCol);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(48);
  const scoreStr = String(result.totalScore);
  const scoreTextWidth = doc.getTextWidth(scoreStr);
  const scoreStartX = (W - scoreTextWidth - 22) / 2;
  doc.text(scoreStr, scoreStartX, scoreY);

  setText(COLOR_SUBTEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(20);
  doc.text('/100', scoreStartX + scoreTextWidth + 2, scoreY);

  // Horizontal score bar (grey track + coloured fill — track colour is OK,
  // only orange fills were removed per the redesign spec)
  const barY = scoreY + 12;
  const barH = 4;
  setFill(COLOR_BORDER);
  doc.roundedRect(CONTENT_LEFT, barY, CONTENT_W, barH, 2, 2, 'F');
  setFill(mainScoreCol);
  doc.roundedRect(CONTENT_LEFT, barY, (CONTENT_W * result.totalScore) / 100, barH, 2, 2, 'F');

  // Author — pushed down to share the newly freed space evenly with the
  // quick stats (the severity legend that used to live here is gone)
  setText(COLOR_SUBTEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const authorY = barY + 28;
  doc.text(
    t(
      'Erstellt von der TW Beckmann Consultancy Services Ltd.',
      'Created by TW Beckmann Consultancy Services Ltd.'
    ),
    W / 2, authorY, { align: 'center' }
  );

  // Quick stats row
  const quickStats = [
    { label: t('Gecrawlt', 'Crawled'), value: String(result.crawlStats.crawledPages) },
    { label: t('Findings', 'Findings'), value: String(result.findings.length) },
    { label: t('Kritisch', 'Critical'), value: String(result.findings.filter(f => f.priority === 'critical').length) },
    { label: t('Wichtig', 'Important'), value: String(result.findings.filter(f => f.priority === 'important').length) },
  ];
  const qsY = authorY + 28;
  const qsSpacing = 40;
  const qsStartX = (W - (quickStats.length - 1) * qsSpacing) / 2;
  quickStats.forEach((s, i) => {
    const cx = qsStartX + i * qsSpacing;
    setText(COLOR_TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(s.value, cx, qsY, { align: 'center' });
    setText(COLOR_SUBTEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(s.label, cx, qsY + 5, { align: 'center' });
  });

  // Cover page footer is drawn by the unified footer loop at the end of
  // the document — no separate cover strip any more.

  // ============================================================
  //  PAGE 2 — Executive Summary (Top 5 Fixes)
  // ============================================================
  if (result.topFindings && result.topFindings.length > 0) {
    doc.addPage();
    addPageHeader();
    y = CONTENT_TOP;

    h1(t('Executive Summary', 'Executive Summary'));

    setText(COLOR_SUBTEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const subline = t(
      'Die 5 wichtigsten Maßnahmen für sofortige Score-Verbesserung',
      'The 5 most impactful actions for immediate score improvement'
    );
    doc.text(subline, CONTENT_LEFT, y);
    y += 8;

    const priorityLabelEs: Record<string, { de: string; en: string }> = {
      critical: { de: 'Kritisch', en: 'Critical' },
      important: { de: 'Wichtig', en: 'Important' },
      recommended: { de: 'Empfohlen', en: 'Recommended' },
      optional: { de: 'Optional', en: 'Optional' },
    };

    result.topFindings.forEach((f, idx) => {
      const title = isDE ? f.title_de : f.title_en;
      const rec = isDE ? f.recommendation_de : f.recommendation_en;
      const gain = f.priority === 'critical' ? 25 : f.priority === 'important' ? 12 : f.priority === 'recommended' ? 5 : 2;
      const pLabel = priorityLabelEs[f.priority][lang];
      const gainLabel = `+${gain} ${t('Pkt.', 'pts')}`;

      // Reserve right-hand column for the gain badge
      const gainBoxW = 22;
      const textW = CONTENT_W - gainBoxW - 4 - 8; // 4mm gap, 8mm left indent for number
      const titleLines = doc.splitTextToSize(title, textW);
      const recLines = doc.splitTextToSize(rec, textW);

      const entryH = titleLines.length * 4.8 + 4 + recLines.length * 4 + 6;
      checkPage(entryH + 2);

      const entryTop = y;

      // Orange index number
      setText(BRAND_ORANGE);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(`${idx + 1}.`, CONTENT_LEFT, entryTop + 4);

      // Title in bold black
      setText(COLOR_TEXT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(titleLines, CONTENT_LEFT + 8, entryTop + 4);
      let cursor = entryTop + 4 + titleLines.length * 4.8;

      // Module + severity subline in subtext grey
      setText(COLOR_SUBTEXT);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`${f.module.toUpperCase()} · ${pLabel}`, CONTENT_LEFT + 8, cursor);
      cursor += 4;

      // Recommendation (full length, wrapped)
      setText(COLOR_TEXT);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(recLines, CONTENT_LEFT + 8, cursor);
      cursor += recLines.length * 4;

      // Score gain badge right-aligned on the entry's title row
      setText(COLOR_GOOD);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text(gainLabel, CONTENT_RIGHT, entryTop + 4, { align: 'right' });

      // Divider line between entries (not after the last one)
      if (idx < result.topFindings.length - 1) {
        y = cursor + 4;
        setDraw(COLOR_BORDER);
        doc.setLineWidth(0.2);
        doc.line(CONTENT_LEFT, y, CONTENT_RIGHT, y);
        y += 4;
      } else {
        y = cursor + 4;
      }
    });
  }

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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(
      t(`${diff.domain} — ${previousLabel} → heute`, `${diff.domain} — ${previousLabel} → today`),
      CONTENT_LEFT, y
    );
    y += 10;

    // Score delta prominently
    const deltaCol = diff.scoreDelta > 0 ? COLOR_GOOD : diff.scoreDelta < 0 ? COLOR_CRITICAL : COLOR_SUBTEXT;
    const deltaSign = diff.scoreDelta > 0 ? '+' : '';
    setText(deltaCol);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text(`${deltaSign}${diff.scoreDelta} ${t('Punkte', 'points')}`, CONTENT_LEFT, y);
    setText(COLOR_SUBTEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`(${diff.previousAudit.totalScore} → ${diff.currentAudit.totalScore})`, CONTENT_LEFT + 60, y);
    y += 12;

    const priorityLabelDiff: Record<string, { de: string; en: string }> = {
      critical: { de: 'Kritisch', en: 'Critical' },
      important: { de: 'Wichtig', en: 'Important' },
      recommended: { de: 'Empfohlen', en: 'Recommended' },
      optional: { de: 'Optional', en: 'Optional' },
    };

    const renderDiffFinding = (f: Finding, accent: [number, number, number]) => {
      const title = isDE ? f.title_de : f.title_en;
      const label = priorityLabelDiff[f.priority][lang];
      const lines = doc.splitTextToSize(title, CONTENT_W - 40);
      const needed = lines.length * 4 + 2;
      checkPage(needed);
      setText(accent);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.text(`${label.toUpperCase()}`, CONTENT_LEFT, y);
      setText(COLOR_SUBTEXT);
      doc.setFont('helvetica', 'normal');
      doc.text(f.module.toUpperCase(), CONTENT_LEFT + 22, y);
      setText(COLOR_TEXT);
      doc.setFontSize(8.5);
      doc.text(lines, CONTENT_LEFT + 40, y);
      y += Math.max(4, lines.length * 4) + 2;
    };

    if (diff.resolved.length > 0) {
      checkPage(10);
      setText(COLOR_GOOD);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(t(`Behoben (${diff.resolved.length})`, `Resolved (${diff.resolved.length})`), CONTENT_LEFT, y);
      y += 6;
      diff.resolved.forEach(f => renderDiffFinding(f, COLOR_GOOD));
      y += 3;
    }

    if (diff.new.length > 0) {
      checkPage(10);
      setText(COLOR_CRITICAL);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(t(`Neu (${diff.new.length})`, `New (${diff.new.length})`), CONTENT_LEFT, y);
      y += 6;
      diff.new.forEach(f => renderDiffFinding(f, COLOR_CRITICAL));
      y += 3;
    }

    if (diff.moduleDeltas.length > 0) {
      checkPage(20);
      setText(COLOR_TEXT);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(t('Modul-Scores', 'Module Scores'), CONTENT_LEFT, y);
      y += 6;

      // Table header
      setText(COLOR_SUBTEXT);
      doc.setFont('helvetica', 'bold');
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
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.text(md.module.toUpperCase(), CONTENT_LEFT + 2, y);
        doc.text(String(prev), CONTENT_LEFT + 70, y, { align: 'right' });
        doc.text(String(curr), CONTENT_LEFT + 105, y, { align: 'right' });
        setText(dColor);
        doc.setFont('helvetica', 'bold');
        doc.text(`${dSign}${md.delta}`, CONTENT_LEFT + 135, y, { align: 'right' });
        y += 5;
        setDraw(COLOR_BORDER);
        doc.line(CONTENT_LEFT, y - 1, CONTENT_RIGHT, y - 1);
      });
    }
  }

  // ============================================================
  //  Module overview
  // ============================================================
  doc.addPage();
  addPageHeader();
  y = CONTENT_TOP;

  h1(t('Modul-Übersicht', 'Module Overview'));

  // ----- Gauge circle grid (PageSpeed Insights style) -----
  // Layout: a single row of N gauges when there are ≤6 modules, otherwise
  // two rows with ceil(N/2) columns. Cell width is derived from the
  // content width minus the gaps so the gauges distribute evenly.
  const gaugeRadius = 10; // mm
  const moduleCount = result.moduleScores.length;
  const gaugeCols = moduleCount <= 6 ? Math.max(1, moduleCount) : Math.ceil(moduleCount / 2);
  const gaugeGapX = 6;
  const cellW = (CONTENT_W - gaugeGapX * (gaugeCols - 1)) / gaugeCols;
  const cellH = 38; // 20mm circle + gap + label + padding
  const gaugeRows = Math.ceil(moduleCount / gaugeCols);

  checkPage(gaugeRows * cellH + 4);
  const gridTop = y;

  result.moduleScores.forEach((ms, idx) => {
    const col = idx % gaugeCols;
    const row = Math.floor(idx / gaugeCols);
    const cellX = CONTENT_LEFT + col * (cellW + gaugeGapX);
    const cellY = gridTop + row * cellH;
    const cx = cellX + cellW / 2;
    const cy = cellY + gaugeRadius + 3;

    // Background ring — grey full circle
    setDraw(COLOR_BORDER);
    doc.setLineWidth(2);
    doc.circle(cx, cy, gaugeRadius, 'S');

    // Score arc — clockwise from 12 o'clock, approximated as a connected
    // polyline drawn as a single stroked path so round caps/joins only
    // appear at the arc endpoints, not at every segment boundary.
    const mCol = scoreColorRgb(ms.score);
    if (ms.score > 0) {
      setDraw(mCol);
      doc.setLineWidth(2);
      doc.setLineCap('round');
      doc.setLineJoin('round');
      const steps = 60;
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + (ms.score / 100) * 2 * Math.PI;
      const startX = cx + gaugeRadius * Math.cos(startAngle);
      const startY = cy + gaugeRadius * Math.sin(startAngle);
      const deltas: [number, number][] = [];
      let prevX = startX;
      let prevY = startY;
      for (let i = 1; i <= steps; i++) {
        const a = startAngle + (endAngle - startAngle) * (i / steps);
        const px = cx + gaugeRadius * Math.cos(a);
        const py = cy + gaugeRadius * Math.sin(a);
        deltas.push([px - prevX, py - prevY]);
        prevX = px;
        prevY = py;
      }
      doc.lines(deltas, startX, startY, [1, 1], 'S', false);
      // Reset line style for subsequent drawings
      doc.setLineCap('butt');
      doc.setLineJoin('miter');
    }

    // Score number centred inside the ring
    setText(COLOR_TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(String(ms.score), cx, cy + 1.5, { align: 'center' });

    // Module label below the circle
    setText(COLOR_SUBTEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(
      isDE ? ms.label_de : ms.label_en,
      cx,
      cellY + gaugeRadius * 2 + 9,
      { align: 'center' }
    );
  });

  y = gridTop + gaugeRows * cellH + 6;

  // ============================================================
  //  Executive summary
  // ============================================================
  h1(t('Zusammenfassung', 'Executive Summary'));
  setText(COLOR_TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const summary = isDE ? result.summary_de : result.summary_en;
  const summaryLines = doc.splitTextToSize(summary, CONTENT_W);
  checkPage(summaryLines.length * 4.5 + 6);
  doc.text(summaryLines, CONTENT_LEFT, y);
  y += summaryLines.length * 4.5 + 8;

  // ============================================================
  //  Findings
  // ============================================================
  h1(t('Verbesserungsempfehlungen', 'Improvement Recommendations'));

  const priorityOrder = { critical: 0, important: 1, recommended: 2, optional: 3 };
  const sortedFindings = [...result.findings].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
  );
  const priorityLabels: Record<string, { de: string; en: string }> = {
    critical: { de: 'Kritisch', en: 'Critical' },
    important: { de: 'Wichtig', en: 'Important' },
    recommended: { de: 'Empfohlen', en: 'Recommended' },
    optional: { de: 'Optional', en: 'Optional' },
  };

  const renderFinding = (f: Finding) => {
    const title = isDE ? f.title_de : f.title_en;
    const desc = isDE ? f.description_de : f.description_en;
    const rec = isDE ? f.recommendation_de : f.recommendation_en;
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(`${label.toUpperCase()} · ${f.module.toUpperCase()}`, cardInnerLeft, labelY);
    let cursor = cardTop + pad + 6.5;

    // Title
    setText(COLOR_TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(titleLines, cardInnerLeft, cursor);
    cursor += titleLines.length * 4.5 + 0.5;

    // Description (subtext, max 2 lines)
    setText(COLOR_SUBTEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(descLines, cardInnerLeft, cursor + 1);
    cursor += descLines.length * 4 + 4.5;

    // Todo line — bold "Todo:" label then recommendation with indent
    setText(COLOR_TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(t('Todo:', 'Todo:'), cardInnerLeft, cursor);
    doc.setFont('helvetica', 'normal');
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
    setText(COLOR_GOOD);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('✓', CONTENT_LEFT, y);
    setText(COLOR_TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(s, CONTENT_W - 8);
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
      h2(t('SSL / TLS', 'SSL / TLS'));
      const ssl = result.sslInfo;
      techRow(t('Grade', 'Grade'), ssl.grade || t('unbekannt', 'unknown'), ['A+', 'A', 'A-', 'B'].includes(ssl.grade || ''));
      techRow(t('Gültig', 'Valid'), ssl.valid ? '✓' : '✗', ssl.valid);
      if (ssl.daysUntilExpiry !== undefined) {
        techRow(t('Läuft ab in', 'Expires in'), `${ssl.daysUntilExpiry} ${t('Tagen', 'days')}`, ssl.daysUntilExpiry > 30);
      }
      if (ssl.issuer) techRow(t('Aussteller', 'Issuer'), ssl.issuer);
      if (ssl.protocols && ssl.protocols.length > 0) {
        techRow(t('Protokolle', 'Protocols'), ssl.protocols.join(', '));
      }
    }

    // DNS
    if (result.dnsInfo) {
      h2(t('DNS & E-Mail', 'DNS & Email'));
      techRow('SPF', result.dnsInfo.hasSPF ? '✓' : t('fehlt', 'missing'), result.dnsInfo.hasSPF);
      techRow('DKIM', result.dnsInfo.hasDKIM ? '✓' : t('fehlt', 'missing'), result.dnsInfo.hasDKIM);
      techRow('DMARC', result.dnsInfo.hasDMARC ? '✓' : t('fehlt', 'missing'), result.dnsInfo.hasDMARC);
      if (result.dnsInfo.mxRecords && result.dnsInfo.mxRecords.length > 0) {
        techRow('MX', result.dnsInfo.mxRecords.join(', '));
      }
    }

    // PageSpeed
    if (result.pageSpeedData && !result.pageSpeedData.error) {
      h2(t('PageSpeed (Mobile) & Core Web Vitals', 'PageSpeed (Mobile) & Core Web Vitals'));
      const ps = result.pageSpeedData;
      if (ps.performanceScore !== undefined) techRow('Performance', `${ps.performanceScore}/100`, ps.performanceScore >= 50);
      if (ps.seoScore !== undefined) techRow('SEO', `${ps.seoScore}/100`, ps.seoScore >= 75);
      if (ps.accessibilityScore !== undefined) techRow(t('Zugänglichkeit', 'Accessibility'), `${ps.accessibilityScore}/100`, ps.accessibilityScore >= 75);
      if (ps.bestPracticesScore !== undefined) techRow(t('Best Practices', 'Best Practices'), `${ps.bestPracticesScore}/100`, ps.bestPracticesScore >= 75);
      if (ps.lcp !== undefined) techRow('LCP', `${Math.round(ps.lcp / 100) / 10}s`, ps.lcp < 2500);
      if (ps.cls !== undefined) techRow('CLS', ps.cls.toFixed(3), ps.cls < 0.1);
      if (ps.inp !== undefined) techRow('INP', `${Math.round(ps.inp)}ms`, ps.inp < 200);
      if (ps.fidField !== undefined) techRow(t('FID (Feld)', 'FID (field)'), `${Math.round(ps.fidField)}ms`, ps.fidField < 100);
      if (ps.fcp !== undefined) techRow('FCP', `${Math.round(ps.fcp / 100) / 10}s`, ps.fcp < 1800);
      if (ps.ttfb !== undefined) techRow('TTFB', `${Math.round(ps.ttfb)}ms`, ps.ttfb < 800);
      if (ps.tbt !== undefined) techRow('TBT', `${Math.round(ps.tbt)}ms`, ps.tbt < 200);
    }

    // Security Headers
    if (result.securityHeaders && !result.securityHeaders.error) {
      h2(t('Security Headers', 'Security Headers'));
      const sh = result.securityHeaders;
      techRow(
        'HSTS',
        sh.hsts ? (sh.hstsMaxAge ? `max-age=${sh.hstsMaxAge}` : t('gesetzt', 'set')) : t('fehlt', 'missing'),
        !!sh.hsts && (sh.hstsMaxAge ?? 0) >= 15552000
      );
      techRow('X-Content-Type-Options', sh.xContentTypeOptions || t('fehlt', 'missing'), sh.xContentTypeOptions?.toLowerCase() === 'nosniff');
      const frameOk = !!sh.xFrameOptions || /frame-ancestors/i.test(sh.csp || '');
      techRow('X-Frame-Options', sh.xFrameOptions || (frameOk ? t('via CSP', 'via CSP') : t('fehlt', 'missing')), frameOk);
      techRow('CSP', sh.csp ? t('gesetzt', 'set') : t('fehlt', 'missing'), !!sh.csp);
      techRow('Referrer-Policy', sh.referrerPolicy || t('fehlt', 'missing'), !!sh.referrerPolicy);
      techRow('Permissions-Policy', sh.permissionsPolicy ? t('gesetzt', 'set') : t('fehlt', 'missing'), !!sh.permissionsPolicy);
      if (sh.hasCookieSecure === false) {
        techRow(t('Cookie Secure-Flag', 'Cookie Secure flag'), t('fehlt', 'missing'), false);
      }
      if (sh.hasMixedContent) {
        techRow('Mixed Content', t('erkannt', 'detected'), false);
      }
    }

    // AI Crawler Readiness
    if (result.aiReadiness && !result.aiReadiness.error) {
      h2(t('AI Crawler Readiness', 'AI Crawler Readiness'));
      const ai = result.aiReadiness;
      techRow('llms.txt', ai.hasLlmsTxt ? t('vorhanden', 'present') : t('fehlt', 'missing'), ai.hasLlmsTxt);
      techRow('llms-full.txt', ai.hasLlmsFullTxt ? t('vorhanden', 'present') : t('fehlt', 'missing'), ai.hasLlmsFullTxt);
      for (const b of ai.bots) {
        const valueText = b.status === 'allowed'
          ? t('erlaubt', 'allowed')
          : b.status === 'blocked'
            ? t('blockiert', 'blocked')
            : b.status === 'partial'
              ? t('teilweise', 'partial')
              : t('nicht geregelt', 'unspecified');
        const ok = b.status === 'allowed' || (b.purpose === 'training' && b.status === 'blocked');
        techRow(`${b.bot} (${b.purpose})`, valueText, ok);
      }
    }

    // Sitemap Coverage
    if (result.sitemapInfo && !result.sitemapInfo.error) {
      h2(t('Sitemap Coverage', 'Sitemap Coverage'));
      const sm = result.sitemapInfo;
      techRow(t('URLs in Sitemap', 'URLs in sitemap'), String(sm.urls.length));
      techRow(t('Sitemap-Index', 'Sitemap index'), sm.isIndex ? t('ja', 'yes') : t('nein', 'no'));
      if (sm.isIndex) {
        techRow(t('Sub-Sitemaps', 'Sub-sitemaps'), String(sm.subSitemaps.length));
      }
      const withLastmod = sm.urls.filter(e => !!e.lastmod).length;
      techRow(t('Mit lastmod', 'With lastmod'), `${withLastmod}/${sm.urls.length}`, withLastmod > 0);
      const withImages = sm.urls.filter(e => e.imageCount > 0).length;
      techRow(t('Mit Bild-Einträgen', 'With image entries'), String(withImages));

      const crawledSet = new Set(result.pages.map(p => p.url));
      const sitemapSet = new Set(sm.urls.map(e => e.url));
      const missingFromCrawl = [...sitemapSet].filter(u => !crawledSet.has(u)).length;
      const missingFromSitemap = [...crawledSet].filter(u => !sitemapSet.has(u)).length;
      techRow(t('In Sitemap, nicht gecrawlt', 'In sitemap, not crawled'), String(missingFromCrawl), missingFromCrawl === 0);
      techRow(t('Gecrawlt, nicht in Sitemap', 'Crawled, not in sitemap'), String(missingFromSitemap), missingFromSitemap === 0);
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
      h2(t('Redirects', 'Redirects'));
      techRow(t('Mit Redirect gecrawlt', 'Crawled via redirect'), String(redirected.length), redirected.length === 0);
      techRow(t('Ketten (>1 Hop)', 'Chains (>1 hop)'), String(chainPages.length), chainPages.length === 0);
      techRow(t('Schleifen', 'Loops'), String(loopPages.length), loopPages.length === 0);
      techRow('HTTPS → HTTP', String(downgradePages.length), downgradePages.length === 0);
    }

    // Link Quality
    const totalGeneric = result.pages.reduce((s, p) => s + (p.genericAnchors?.length || 0), 0);
    const totalEmpty = result.pages.reduce((s, p) => s + (p.emptyAnchors || 0), 0);
    const noindexPages = result.pages.filter(p => p.hasNoindex).length;
    if (totalGeneric > 0 || totalEmpty > 0 || noindexPages > 0) {
      h2(t('Link Quality', 'Link Quality'));
      techRow(t('Generische Ankertexte', 'Generic anchor texts'), String(totalGeneric), totalGeneric === 0);
      techRow(t('Links ohne Text', 'Links without text'), String(totalEmpty), totalEmpty === 0);
      techRow(t('Seiten mit noindex', 'Pages with noindex'), String(noindexPages));
    }

    // Safe Browsing
    if (result.safeBrowsingData) {
      h2(t('Google Safe Browsing', 'Google Safe Browsing'));
      techRow(
        t('Status', 'Status'),
        result.safeBrowsingData.isSafe ? t('Sicher', 'Safe') : t('GEFÄHRLICH', 'DANGEROUS'),
        result.safeBrowsingData.isSafe
      );
      if (result.safeBrowsingData.threats && result.safeBrowsingData.threats.length > 0) {
        techRow(t('Bedrohungen', 'Threats'), result.safeBrowsingData.threats.join(', '), false);
      }
    }

    // Crawl Statistics
    h2(t('Crawl-Statistik', 'Crawl Statistics'));
    techRow(t('Seiten gecrawlt', 'Pages crawled'), String(result.crawlStats.crawledPages));
    techRow(t('Defekte Links', 'Broken links'), String(result.crawlStats.brokenLinks.length), result.crawlStats.brokenLinks.length === 0);
    techRow(t('Weiterleitungen', 'Redirects'), String(result.crawlStats.redirectChains.length), result.crawlStats.redirectChains.length < 3);
    techRow(t('Externe Links', 'External links'), String(result.crawlStats.externalLinks));
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
      doc.setFont('helvetica', 'bold');
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
        const chainStr = p.redirectChain.concat(p.finalUrl).join(' → ');
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
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(label + ':', CONTENT_LEFT + 2, y);
        setText(COLOR_TEXT);
        const valueLines = doc.splitTextToSize(value, CONTENT_W - 45);
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
      doc.setFont('helvetica', 'bold');
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
          doc.setFont('helvetica', 'normal');
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
          doc.setFont('helvetica', 'normal');
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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `beckmanndigital.com · TW Beckmann Consultancy Services Ltd. · ${dateStr} · ${t('Seite', 'Page')} ${i}/${totalPages}`,
      W / 2, H - FOOTER_H + 5, { align: 'center' }
    );
  }

  const filename = `${result.domain}-audit-${lang.toUpperCase()}-${new Date(result.auditedAt).toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
