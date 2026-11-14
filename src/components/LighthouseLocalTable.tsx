'use client';

// ultimate-41, point 4: the local Lighthouse lab values, one row per page and strategy (lib/lighthouse/view.ts).
import React from 'react';
import type { Lang, LighthouseLocalInfo } from '@/types';
import { lighthouseRows, lighthouseTitle, lighthouseFooter } from '@/lib/lighthouse/view';

const cell: React.CSSProperties = { padding: '4px 6px', textAlign: 'left' };

export function LighthouseLocalTable({ info, lang }: { info: LighthouseLocalInfo; lang: Lang }) {
  const de = lang === 'de';
  const rows = lighthouseRows(info, lang);
  return (
    <div data-testid="lighthouse-local" style={{ alignSelf: 'start', minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', marginBottom: '1rem' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>{lighthouseTitle(info, lang)}</h3>
      <div data-scroll="lighthouse-local" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ color: 'var(--text-faint)' }}>
            <th style={cell}>{de ? 'Seite' : 'Page'}</th>
            <th style={cell}>{de ? 'Gerät' : 'Device'}</th>
            <th style={cell}>Score</th>
            <th style={cell}>LCP</th>
            <th style={cell}>CLS</th>
            <th style={cell}>TBT</th>
            <th style={cell}>{de ? 'Läufe' : 'Runs'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={`${r.url} ${r.strategy}`} style={{ borderTop: '1px solid var(--border-soft)' }}>
              <td style={{ ...cell, wordBreak: 'break-all' }}>{r.url}</td>
              <td style={cell}>{r.strategy}</td>
              <td style={{ ...cell, fontWeight: 600 }}>{r.score}</td>
              <td style={cell}>{r.lcp}</td>
              <td style={cell}>{r.cls}</td>
              <td style={cell}>{r.tbt}</td>
              <td style={cell}>{r.runs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>{lighthouseFooter(info, lang)}</p>
    </div>
  );
}
