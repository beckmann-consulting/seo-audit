import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEO Audit Widget',
  description: 'Free SEO audit — by Beckmann Digital',
};

// Standalone layout — the widget is meant to be embedded in an iframe.
// We strip the global #f8f8f6 background from the root layout.tsx and
// render with a transparent body so the page itself can decide the
// background based on the ?embed=1 query parameter (see page.tsx).
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: 'transparent',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {children}
    </div>
  );
}
