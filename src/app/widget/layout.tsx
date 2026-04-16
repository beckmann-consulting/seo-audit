import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEO Audit Widget',
  description: 'Free SEO audit — by Beckmann Digital',
};

// Standalone layout — the widget is meant to be embedded in an iframe
// on beckmanndigital.com, so we strip the global #f8f8f6 background
// from the root layout.tsx and render plain white full-bleed.
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: '#ffffff',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#1a1a1a',
      }}
    >
      {children}
    </div>
  );
}
