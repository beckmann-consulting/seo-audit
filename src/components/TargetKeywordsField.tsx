'use client';

// ultimate-41, point 13: the target keyword field of the advanced options. Codex, review of 32e99e2094 (finding 3):
// the label names the field (id and htmlFor), and a parse error is tied to it (aria-invalid, aria-describedby) and
// announced when it appears (role="alert").
import React from 'react';
import type { Lang } from '@/types';

export const TARGET_KEYWORDS_ID = 'audit-target-keywords';
const ERROR_ID = `${TARGET_KEYWORDS_ID}-error`;

export function TargetKeywordsField({ value, onChange, error, lang, labelStyle, inputStyle }: {
  value: string;
  onChange: (value: string) => void;
  error?: { line: number; de: string; en: string };
  lang: Lang;
  labelStyle: React.CSSProperties;
  inputStyle: React.CSSProperties;
}) {
  const de = lang === 'de';
  return (
    <>
      <label style={labelStyle} htmlFor={TARGET_KEYWORDS_ID}>
        {de ? 'Ziel-Keywords' : 'Target keywords'}{' '}
        <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>
          ({de ? 'eine Zeile je Seite, "URL oder Pfad = Keyword"' : 'one line per page, "URL or path = keyword"'})
        </span>
      </label>
      <textarea
        id={TARGET_KEYWORDS_ID}
        data-testid="target-keywords"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={'/leistungen = Webdesign Hamburg\nhttps://example.com/kontakt = Webagentur Kontakt'}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ERROR_ID : undefined}
        style={{ ...inputStyle, fontFamily: 'ui-monospace, monospace', fontSize: 11, height: 'auto', padding: '6px 10px', borderColor: error ? 'var(--fail)' : undefined }}
      />
      {error && (
        <p id={ERROR_ID} role="alert" style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fail)' }}>
          {de ? `Zeile ${error.line}: ${error.de}` : `Line ${error.line}: ${error.en}`}
        </p>
      )}
    </>
  );
}
