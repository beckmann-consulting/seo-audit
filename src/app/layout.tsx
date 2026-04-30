import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'SEO Audit Pro',
  description: 'Vollständiger, reproduzierbarer SEO-Audit mit PDF-Export',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Sets data-theme on <html> before React hydrates, so the page never
// renders with the wrong palette and then snaps. Mirrors the logic in
// src/lib/theme.ts but inlined here as plain JS because it has to run
// before the React bundle. Storage key + value vocabulary stay in sync
// with that module.
const themeBootScript = `
(function() {
  try {
    var stored = localStorage.getItem('seo-audit-theme');
    var theme = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
    var resolved = theme === 'system'
      ? (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body style={{ margin: 0, background: 'var(--bg)', minHeight: '100vh' }}>{children}</body>
    </html>
  );
}
