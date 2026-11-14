'use client';

// ultimate-41: the check log under the findings, one row per point of the order (lib/checks/check-log.ts).
// A <details> element folds it, so it needs no state and renders the same on the server.
import React from 'react';
import type { CheckLogEntry, Lang } from '@/types';
import { checkLogRows, checkLogHeadline } from '@/lib/checks/check-log-view';
import type { Severity } from '@/lib/util/severity-classifier';

const COLOR: Record<Severity, string> = {
  good: 'var(--pass)',
  warn: 'var(--warn)',
  bad: 'var(--fail)',
  info: 'var(--info)',
  neutral: 'var(--text-faint)',
};

export function CheckLogSection({ entries, lang, open = false }: { entries: readonly CheckLogEntry[]; lang: Lang; open?: boolean }) {
  if (entries.length === 0) return null;
  const rows = checkLogRows(entries, lang);
  const de = lang === 'de';
  return (
    <details open={open} data-testid="check-log" style={{ marginTop: '1rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        {de ? 'Prüfprotokoll' : 'Check log'} · <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>{checkLogHeadline(entries, lang)}</span>
      </summary>
      <div data-scroll="check-log" style={{ overflowX: 'auto', marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-faint)' }}>
            <th style={{ padding: '4px 6px' }}>{de ? 'Punkt' : 'Point'}</th>
            <th style={{ padding: '4px 6px' }}>{de ? 'Prüfung' : 'Check'}</th>
            <th style={{ padding: '4px 6px' }}>{de ? 'Status' : 'Status'}</th>
            <th style={{ padding: '4px 6px' }}>{de ? 'Ergebnis' : 'Result'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.check} data-check={r.check} data-status={r.status} style={{ borderTop: '1px solid var(--border-soft)', verticalAlign: 'top' }}>
              <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{r.point}</td>
              <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{r.check}</td>
              <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', fontWeight: 600, color: COLOR[r.severity] }}>{r.statusLabel}</td>
              <td style={{ padding: '4px 6px' }}>
                {r.summary}
                {r.codes && <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--text-faint)' }}>{r.codes}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </details>
  );
}
