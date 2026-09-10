import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Niche Expense Scanner',
    template: '%s · Niche Expense Scanner',
  },
  description:
    'Scan receipts and track expenses, built for freelance tattoo artists and studios. Needles, ink, stencil paper and booth rent — categorised automatically.',
  applicationName: 'Niche Expense Scanner',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Expense Scanner' },
  // Expense data has no business in search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available — pinching a receipt total is exactly what a user
  // will want to do, and disabling it is an accessibility failure.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
