'use client';

import { useState, type ReactNode } from 'react';
import type { GscRow, GscTotals } from '@/types';
import { formatNumber, formatCtr, formatPosition } from '@/lib/util/format';

// ============================================================
//  Pure data prep (exported for tests)
// ============================================================

// Filter rows whose dimension key is missing / empty / "(other)" —
// these are the long-tail entries GSC anonymises before serving them
// via the API. Their impressions are still in the totals (the totals
// query has no dimension), so the user-visible message is "hidden
// from the table, included in the banner totals".
function isAnonymisedKey(key: string | undefined): boolean {
  if (!key) return true;
  const trimmed = key.trim();
  return trimmed === '' || trimmed === '(other)';
}

export interface PreparedGscRows {
  visible: GscRow[];        // post-filter, post-sort, post-slice (ready for <tr>)
  rowsAfterFilter: GscRow[]; // post-filter, post-sort — used for "show all" toggle
  filteredCount: number;     // count of anonymised rows removed
  impressionsGapPct: number; // % of totals.impressions NOT in `rowsAfterFilter`
}

export function prepareGscRows(
  rows: GscRow[],
  totals: GscTotals,
  opts: { topN: number; showAll: boolean },
): PreparedGscRows {
  const filtered = rows.filter(r => !isAnonymisedKey(r.keys?.[0]));
  const filteredCount = rows.length - filtered.length;

  // Sort by clicks DESC, ties broken by impressions DESC (deterministic
  // ordering — important for snapshot stability).
  const sorted = [...filtered].sort((a, b) => {
    if (b.clicks !== a.clicks) return b.clicks - a.clicks;
    return b.impressions - a.impressions;
  });

  const visible = opts.showAll ? sorted : sorted.slice(0, opts.topN);

  const sumImpressions = sorted.reduce((acc, r) => acc + r.impressions, 0);
  const impressionsGapPct = totals.impressions > 0
    ? Math.round(((totals.impressions - sumImpressions) / totals.impressions) * 100)
    : 0;

  return { visible, rowsAfterFilter: sorted, filteredCount, impressionsGapPct };
}

// ============================================================
//  Component
// ============================================================

const TOP_N = 25;

export interface GscRowsTableProps {
  rows: GscRow[];
  totals: GscTotals;
  keyHeader: string;             // "Query" / "Seite"
  renderKey: (key: string) => ReactNode; // first-cell renderer (plain text vs. link)
  isDE: boolean;
}

export function GscRowsTable({ rows, totals, keyHeader, renderKey, isDE }: GscRowsTableProps) {
  const [showAll, setShowAll] = useState(false);
  const t = (de: string, en: string) => (isDE ? de : en);
  const prep = prepareGscRows(rows, totals, { topN: TOP_N, showAll });

  if (prep.rowsAfterFilter.length === 0) {
    return (
      <div style={{ fontSize: 13, color: '#6b6b68', padding: '12px 0' }}>
        {t('Keine Daten für diese Tabelle.', 'No data for this table.')}
      </div>
    );
  }

  const canToggle = prep.rowsAfterFilter.length > TOP_N;

  return (
    <div>
      {/* Wrapper provides horizontal scroll on narrow viewports
          (<768px). min-width on the inner table prevents column
          squish that would render numbers unreadable. */}
      <div style={{ overflowX: 'auto', border: '1px solid #e0ddd8', borderRadius: 8, background: '#fff' }}>
        <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8f8f6', textAlign: 'left' }}>
              <th style={thStyle}>{keyHeader}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Klicks', 'Clicks')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Impressions', 'Impressions')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('CTR', 'CTR')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('Position', 'Position')}</th>
            </tr>
          </thead>
          <tbody>
            {prep.visible.map((row, idx) => (
              <tr key={`${row.keys?.[0] ?? '?'}-${idx}`} style={{ borderTop: '1px solid #f0ede8' }}>
                <td style={tdStyle}>{renderKey(row.keys?.[0] ?? '')}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.clicks)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatNumber(row.impressions)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCtr(row.ctr)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatPosition(row.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canToggle && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setShowAll(s => !s)}
            style={{
              fontSize: 12, padding: '6px 12px', border: '1px solid #e0ddd8',
              background: '#fff', borderRadius: 6, cursor: 'pointer', color: '#1a1a18',
            }}
          >
            {showAll
              ? t(`Weniger anzeigen (Top ${TOP_N})`, `Show less (top ${TOP_N})`)
              : t(`Alle ${prep.rowsAfterFilter.length} anzeigen`, `Show all ${prep.rowsAfterFilter.length}`)}
          </button>
        </div>
      )}
      {prep.filteredCount > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#9b9b68', fontStyle: 'italic' }}>
          {t(
            `${prep.filteredCount} anonymisierte Long-Tail-Einträge ausgeblendet (~${prep.impressionsGapPct}% der Impressions). In den Banner-Totals enthalten.`,
            `${prep.filteredCount} anonymised long-tail entries hidden (~${prep.impressionsGapPct}% of impressions). Included in the banner totals.`,
          )}
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 600,
  color: '#6b6b68',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12,
  color: '#1a1a18',
  verticalAlign: 'top',
};
