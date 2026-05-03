// Embedded Inter font (Regular + Bold) for the PDF report. The default
// jsPDF Helvetica is WinAnsi-only — non-Latin-1 codepoints (✓, ✗, →,
// em-dash, smart quotes, etc.) silently mojibake or get dropped. By
// registering Inter as a real TTF font, jsPDF treats text as UTF-8 and
// uses the actual glyph table — so umlauts, em-dashes, curly quotes,
// the Euro sign, etc. all render correctly.
//
// Coverage: latin + latin-ext subset (~140 KB TTF / ~190 KB base64 per
// weight). Covers all Western-European scripts plus General Punctuation,
// Currency Symbols and Latin-Extended-A/B. Notable holes: Dingbats
// (✓ U+2713, ✗ U+2717), Arrows (→ U+2192), Geometric Shapes — these are
// handled in pdf-generator.ts via vector primitives or ASCII fallbacks.
//
// License: SIL Open Font License 1.1 — see LICENSE-Inter.txt.

import type { jsPDF } from 'jspdf';
import { INTER_REGULAR_BASE64 } from './inter-regular';
import { INTER_BOLD_BASE64 } from './inter-bold';

export const INTER_FONT_FAMILY = 'Inter';

export function registerInterFont(doc: jsPDF): void {
  doc.addFileToVFS('Inter-Regular.ttf', INTER_REGULAR_BASE64);
  doc.addFont('Inter-Regular.ttf', INTER_FONT_FAMILY, 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', INTER_BOLD_BASE64);
  doc.addFont('Inter-Bold.ttf', INTER_FONT_FAMILY, 'bold');
  doc.setFont(INTER_FONT_FAMILY, 'normal');
}
