import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { GscRowsTable, prepareGscRows } from './GscRowsTable';
import type { GscRow, GscTotals } from '@/types';

// ============================================================
//  prepareGscRows — pure data prep
// ============================================================

function row(key: string, clicks: number, impressions: number, ctr = 0.05, position = 5): GscRow {
  return { keys: [key], clicks, impressions, ctr, position };
}

const totals: GscTotals = { clicks: 100, impressions: 10000, ctr: 0.01, position: 12 };

describe('prepareGscRows — anonymised filter', () => {
  it('removes rows with empty / missing / "(other)" keys, counts them in filteredCount', () => {
    const rows: GscRow[] = [
      row('seo audit', 50, 1000),
      row('', 5, 500),
      { keys: undefined, clicks: 3, impressions: 200, ctr: 0.015, position: 8 },
      row('(other)', 10, 800),
      row('   ', 1, 100),
      row('how to seo', 30, 600),
    ];
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: false });
    expect(prep.visible.map(r => r.keys?.[0])).toEqual(['seo audit', 'how to seo']);
    expect(prep.filteredCount).toBe(4);
  });

  it('returns filteredCount=0 when no anonymised rows are present', () => {
    const rows = [row('a', 10, 100), row('b', 5, 50)];
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: false });
    expect(prep.filteredCount).toBe(0);
  });
});

describe('prepareGscRows — sort by clicks DESC', () => {
  it('orders rows by clicks DESC; ties broken by impressions DESC', () => {
    const rows = [
      row('low', 5, 100),
      row('high-imp-tie', 50, 5000),
      row('high', 100, 1000),
      row('high-tie', 50, 500),
    ];
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: false });
    expect(prep.visible.map(r => r.keys?.[0])).toEqual([
      'high', 'high-imp-tie', 'high-tie', 'low',
    ]);
  });
});

describe('prepareGscRows — top-N slice and showAll toggle', () => {
  it('slices to topN when showAll=false', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`q${i}`, 100 - i, 1000 - i * 10));
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: false });
    expect(prep.visible.length).toBe(25);
    expect(prep.rowsAfterFilter.length).toBe(40);
  });

  it('returns all rows when showAll=true', () => {
    const rows = Array.from({ length: 40 }, (_, i) => row(`q${i}`, 100 - i, 1000 - i * 10));
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: true });
    expect(prep.visible.length).toBe(40);
  });

  it('does not pad when fewer rows than topN', () => {
    const rows = [row('a', 10, 100), row('b', 5, 50)];
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: false });
    expect(prep.visible.length).toBe(2);
  });
});

describe('prepareGscRows — impressionsGapPct', () => {
  it('computes percentage of totals.impressions NOT in the filtered+sorted rows', () => {
    // 1000 + 500 + 200 = 1700 visible, 10000 totals → 83% gap
    const rows = [row('a', 50, 1000), row('b', 30, 500), row('c', 10, 200)];
    const prep = prepareGscRows(rows, totals, { topN: 25, showAll: false });
    expect(prep.impressionsGapPct).toBe(83);
  });

  it('returns 0 when totals.impressions is 0 (avoid divide-by-zero)', () => {
    const zeroTotals: GscTotals = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const prep = prepareGscRows([row('a', 0, 0)], zeroTotals, { topN: 25, showAll: false });
    expect(prep.impressionsGapPct).toBe(0);
  });
});

// ============================================================
//  GscRowsTable — render snapshots
// ============================================================

describe('GscRowsTable — render output', () => {
  const sampleRows: GscRow[] = [
    { keys: ['seo audit'], clicks: 1234, impressions: 56789, ctr: 0.0217, position: 4.3 },
    { keys: ['how to seo'], clicks: 200, impressions: 8000, ctr: 0.025, position: 12.1 },
  ];

  it('renders all columns with formatted numbers (thousands separator, % CTR, 1-decimal position)', () => {
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: sampleRows,
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    // Headers
    expect(html).toContain('Query');
    expect(html).toContain('Klicks');
    expect(html).toContain('Impressions');
    expect(html).toContain('CTR');
    expect(html).toContain('Position');
    // Formatted values: clicks 1234 → "1.234", impressions 56789 → "56.789"
    expect(html).toContain('1.234');
    expect(html).toContain('56.789');
    // CTR 0.0217 → "2.2 %" (toFixed(1) rounds 2.17 → 2.2)
    expect(html).toContain('2.2 %');
    // Position 4.3 → "4.3"
    expect(html).toContain('4.3');
  });

  it('uses renderKey for the first column (link rendering vs plain text)', () => {
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: [{ keys: ['https://example.com/page'], clicks: 10, impressions: 100, ctr: 0.1, position: 1 }],
        totals,
        keyHeader: 'Seite',
        renderKey: (k: string) => createElement('a', { href: k, target: '_blank' }, '/page'),
        isDE: true,
      }),
    );
    expect(html).toContain('href="https://example.com/page"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>/page<');
  });

  it('renders the empty-state message when no rows survive the filter', () => {
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: [{ keys: [''], clicks: 5, impressions: 50, ctr: 0.1, position: 1 }],
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    expect(html).toContain('Keine Daten');
  });

  it('does NOT render the toggle button when row count <= topN', () => {
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: sampleRows, // 2 rows
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    expect(html).not.toContain('Alle ');
    expect(html).not.toContain('Show all');
  });

  it('renders the toggle button when row count > topN', () => {
    const manyRows = Array.from({ length: 30 }, (_, i): GscRow => ({
      keys: [`q${i}`], clicks: 30 - i, impressions: 300 - i, ctr: 0.05, position: 5,
    }));
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: manyRows,
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    expect(html).toContain('Alle 30 anzeigen');
  });

  it('renders the anonymised footer hint when filteredCount > 0', () => {
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: [
          { keys: ['real query'], clicks: 10, impressions: 100, ctr: 0.1, position: 1 },
          { keys: [''], clicks: 0, impressions: 50, ctr: 0, position: 0 },
        ],
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    expect(html).toContain('1 anonymisierte');
    expect(html).toContain('Banner-Totals');
  });

  it('emits the mobile-scroll wrapper styles (overflow-x:auto + table min-width)', () => {
    // Regression guard for the <768px viewport behaviour: the wrapper
    // must scroll horizontally and the inner table must keep a min-width
    // so columns don't collapse into unreadable strings on narrow screens.
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: sampleRows,
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    expect(html).toContain('overflow-x:auto');
    expect(html).toContain('min-width:480px');
  });

  it('does NOT render the footer hint when no anonymised rows are present', () => {
    const html = renderToString(
      createElement(GscRowsTable, {
        rows: [{ keys: ['only real'], clicks: 10, impressions: 100, ctr: 0.1, position: 1 }],
        totals,
        keyHeader: 'Query',
        renderKey: (k: string) => k,
        isDE: true,
      }),
    );
    expect(html).not.toContain('anonymisierte');
    expect(html).not.toContain('anonymised');
  });
});
