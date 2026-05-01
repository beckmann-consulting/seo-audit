import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BingRowsTable, prepareBingRows } from './BingRowsTable';
import type { BingRow } from '@/types';

// ============================================================
//  prepareBingRows — pure data prep
// ============================================================

const queryRow = (q: string, clicks: number, impressions: number, ctr = 0.05, position = 5): BingRow => ({
  query: q, clicks, impressions, ctr, position,
});

describe('prepareBingRows — sort by clicks DESC', () => {
  it('orders rows by clicks DESC; ties broken by impressions DESC', () => {
    const rows = [
      queryRow('low', 5, 100),
      queryRow('high-imp-tie', 50, 5000),
      queryRow('high', 100, 1000),
      queryRow('high-tie', 50, 500),
    ];
    const prep = prepareBingRows(rows, { topN: 25, showAll: false });
    expect(prep.visible.map(r => r.query)).toEqual([
      'high', 'high-imp-tie', 'high-tie', 'low',
    ]);
  });
});

describe('prepareBingRows — top-N slice and showAll toggle', () => {
  it('slices to topN when showAll=false', () => {
    const rows = Array.from({ length: 40 }, (_, i) => queryRow(`q${i}`, 100 - i, 1000 - i * 10));
    const prep = prepareBingRows(rows, { topN: 25, showAll: false });
    expect(prep.visible.length).toBe(25);
    expect(prep.rowsAfterSort.length).toBe(40);
  });

  it('returns all rows when showAll=true', () => {
    const rows = Array.from({ length: 40 }, (_, i) => queryRow(`q${i}`, 100 - i, 1000 - i * 10));
    const prep = prepareBingRows(rows, { topN: 25, showAll: true });
    expect(prep.visible.length).toBe(40);
  });

  it('does not pad when fewer rows than topN', () => {
    const rows = [queryRow('a', 10, 100), queryRow('b', 5, 50)];
    const prep = prepareBingRows(rows, { topN: 25, showAll: false });
    expect(prep.visible.length).toBe(2);
  });
});

// ============================================================
//  BingRowsTable — render output
// ============================================================

describe('BingRowsTable — render output', () => {
  const sampleRows: BingRow[] = [
    { query: 'seo audit', clicks: 1234, impressions: 56789, ctr: 0.0217, position: 4.3 },
    { query: 'how to seo', clicks: 200, impressions: 8000, ctr: 0.025, position: 12.1 },
  ];

  it('renders all columns with formatted numbers (thousands separator, % CTR, 1-decimal position)', () => {
    const html = renderToString(
      createElement(BingRowsTable, {
        rows: sampleRows,
        keyHeader: 'Suchanfrage',
        renderKey: (k: string) => k,
        keyOf: (r: BingRow) => r.query,
        isDE: true,
      }),
    );
    expect(html).toContain('Suchanfrage');
    expect(html).toContain('Klicks');
    expect(html).toContain('Impressions');
    expect(html).toContain('CTR');
    expect(html).toContain('Position');
    // Formatted: 1234 → "1.234"
    expect(html).toContain('1.234');
    expect(html).toContain('56.789');
    // CTR 0.0217 → "2.2 %"
    expect(html).toContain('2.2 %');
    expect(html).toContain('4.3');
  });

  it('uses keyOf to pick the primary key from each row', () => {
    const pageRows: BingRow[] = [
      { page: 'https://example.com/foo', clicks: 10, impressions: 100, ctr: 0.1, position: 1 },
    ];
    const html = renderToString(
      createElement(BingRowsTable, {
        rows: pageRows,
        keyHeader: 'Seite',
        renderKey: (k: string) => createElement('a', { href: k, target: '_blank' }, '/foo'),
        keyOf: (r: BingRow) => r.page,
        isDE: true,
      }),
    );
    expect(html).toContain('href="https://example.com/foo"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>/foo<');
  });

  it('renders empty-state message when rows are empty', () => {
    const html = renderToString(
      createElement(BingRowsTable, {
        rows: [],
        keyHeader: 'Suchanfrage',
        renderKey: (k: string) => k,
        keyOf: (r: BingRow) => r.query,
        isDE: true,
      }),
    );
    expect(html).toContain('Keine Daten');
  });

  it('does NOT render the toggle button when row count <= topN', () => {
    const html = renderToString(
      createElement(BingRowsTable, {
        rows: sampleRows,
        keyHeader: 'Suchanfrage',
        renderKey: (k: string) => k,
        keyOf: (r: BingRow) => r.query,
        isDE: true,
      }),
    );
    expect(html).not.toContain('Alle ');
    expect(html).not.toContain('Show all');
  });

  it('renders the toggle button when row count > topN', () => {
    const manyRows: BingRow[] = Array.from({ length: 30 }, (_, i) => ({
      query: `q${i}`, clicks: 30 - i, impressions: 300 - i, ctr: 0.05, position: 5,
    }));
    const html = renderToString(
      createElement(BingRowsTable, {
        rows: manyRows,
        keyHeader: 'Suchanfrage',
        renderKey: (k: string) => k,
        keyOf: (r: BingRow) => r.query,
        isDE: true,
      }),
    );
    expect(html).toContain('Alle 30 anzeigen');
  });

  it('emits the mobile-scroll wrapper styles (overflow-x:auto + table min-width)', () => {
    const html = renderToString(
      createElement(BingRowsTable, {
        rows: sampleRows,
        keyHeader: 'Suchanfrage',
        renderKey: (k: string) => k,
        keyOf: (r: BingRow) => r.query,
        isDE: true,
      }),
    );
    expect(html).toContain('overflow-x:auto');
    expect(html).toContain('min-width:480px');
  });
});
