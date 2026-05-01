'use client';

import { useState, type ReactNode } from 'react';
import type { BingRow } from '@/types';
import { formatNumber, formatCtr, formatPosition } from '@/lib/util/format';

// ============================================================
//  Pure data prep (exported for tests)
// ============================================================

// Slimmer than prepareGscRows: Bing's API doesn't return anonymised
// long-tail rows (no "(other)" placeholder), so the GSC-side
// filter / impressions-gap accounting is unnecessary here. Only the
// click-DESC sort + topN-slice behaviour transfers.

export interface PreparedBingRows {
  visible: BingRow[];        // post-sort, post-slice (ready for <tr>)
  rowsAfterSort: BingRow[];  // post-sort — used for "show all" toggle
}

export function prepareBingRows(
  rows: BingRow[],
  opts: { topN: number; showAll: boolean },
): PreparedBingRows {
  // Sort by clicks DESC, ties broken by impressions DESC (deterministic
  // ordering — important for snapshot stability across re-renders).
  const sorted = [...rows].sort((a, b) => {
    if (b.clicks !== a.clicks) return b.clicks - a.clicks;
    return b.impressions - a.impressions;
  });
  const visible = opts.showAll ? sorted : sorted.slice(0, opts.topN);
  return { visible, rowsAfterSort: sorted };
}

// ============================================================
//  Component
// ============================================================

const TOP_N = 25;

export interface BingRowsTableProps {
  rows: BingRow[];
  keyHeader: string;                      // "Suchanfrage" / "Seite"
  // First-cell renderer. Receives the row's primary key (query for
  // GetQueryStats rows, page URL for GetPageStats rows). The caller
  // decides whether to render plain text or a clickable link.
  renderKey: (key: string) => ReactNode;
  // Selects which row field to use as the primary key.
  keyOf: (row: BingRow) => string | undefined;
  isDE: boolean;
}

export function BingRowsTable({ rows, keyHeader, renderKey, keyOf, isDE }: BingRowsTableProps) {
  const [showAll, setShowAll] = useState(false);
  const t = (de: string, en: string) => (isDE ? de : en);
  const prep = prepareBingRows(rows, { topN: TOP_N, showAll });

  if (prep.rowsAfterSort.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
        {t('Keine Daten für diese Tabelle.', 'No data for this table.')}
      </div>
    );
  }

  const canToggle = prep.rowsAfterSort.length > TOP_N;

  return (
    <div>
      {/* Wrapper provides horizontal scroll on narrow viewports
          (<768px). min-width on the inner table prevents column
          squish that would render numbers unreadable. */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
        <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg)', textAlign: 'left' }}>
              <th style={thStyle}>{keyHeader}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Klicks', 'Clicks')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Impressions', 'Impressions')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('CTR', 'CTR')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Position', 'Position')}</th>
            </tr>
          </thead>
          <tbody>
            {prep.visible.map((row, idx) => {
              const key = keyOf(row) ?? '';
              return (
                <tr key={`${key}-${idx}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <td style={tdStyle}>{renderKey(key)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.clicks)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.impressions)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCtr(row.ctr)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatPosition(row.position)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canToggle && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowAll(s => !s)}
            style={{
              fontSize: 12, padding: '6px 12px', border: '1px solid var(--border)',
              background: 'var(--surface)', borderRadius: 6, cursor: 'pointer', color: 'var(--text)',
            }}
          >
            {showAll
              ? t(`Weniger anzeigen (Top ${TOP_N})`, `Show less (top ${TOP_N})`)
              : t(`Alle ${prep.rowsAfterSort.length} anzeigen`, `Show all ${prep.rowsAfterSort.length}`)}
          </button>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: 'var(--text)',
  verticalAlign: 'top',
};
