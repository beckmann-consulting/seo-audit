import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEO Audit Pro',
  description: 'Vollständiger, reproduzierbarer SEO-Audit mit PDF-Export',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body style={{ margin: 0, background: '#f8f8f6', minHeight: '100vh' }}>{children}</body>
    </html>
  );
}
