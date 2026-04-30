'use client';

import { type ReactNode } from 'react';

// Variant-driven status banner. Used for external-API state surfaces
// (Search Console G1d, future Browserless E1, axe-core F1, Bing G3,
// DataForSEO G4) so each integration gets a consistent visual.
//
// TODO: Existing inline banners in AuditApp.tsx (Google API Key hint
// at line ~475, error banner at ~710, strengths panel at ~901) should
// be migrated to this component in a future cleanup ticket — out of
// scope for G1d to avoid regression risk in unrelated panels.
export type StatusBannerVariant = 'ok' | 'info' | 'warning' | 'error';

export interface StatusBannerProps {
  variant: StatusBannerVariant;
  title: string;
  children?: ReactNode;
  // When provided, an "×" button is rendered top-right. The handler is
  // a plain () => void so the parent decides what dismissal means
  // (drop a single warning, hide the whole banner, etc).
  onDismiss?: () => void;
}

const PALETTE: Record<StatusBannerVariant, { bg: string; border: string; fg: string }> = {
  ok:      { bg: 'var(--pass-bg)',        border: 'var(--pass-border)', fg: 'var(--pass)' },
  info:    { bg: 'var(--info-bg-banner)', border: 'var(--info-border)', fg: 'var(--info)' },
  warning: { bg: 'var(--warn-bg-banner)', border: 'var(--warn-border)', fg: 'var(--warn)' },
  error:   { bg: 'var(--fail-bg)',        border: 'var(--fail-border)', fg: 'var(--fail)' },
};

const ICON: Record<StatusBannerVariant, string> = {
  ok: '✓',
  info: 'ⓘ',
  warning: '⚠',
  error: '✕',
};

export function StatusBanner({ variant, title, children, onDismiss }: StatusBannerProps) {
  const c = PALETTE[variant];
  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.fg,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: '1rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1.4, flexShrink: 0 }}>
        {ICON[variant]}
      </span>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: children ? 4 : 0 }}>{title}</div>
        {children && <div style={{ fontWeight: 400 }}>{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'none',
            border: 'none',
            color: c.fg,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px',
            flexShrink: 0,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
