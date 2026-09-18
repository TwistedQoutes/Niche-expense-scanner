import type { Metadata, Viewport } from 'next';

import { ToastProvider } from '@/components/ui/Toast';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'JobFlow AI — Turn Leads Into Jobs. Automatically.',
    template: '%s · JobFlow AI',
  },
  description:
    'JobFlow AI helps local service businesses capture leads, generate quotes, follow up automatically, schedule jobs, and turn customers into repeat business — all from one simple platform.',
  applicationName: 'JobFlow AI',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'JobFlow' },
  openGraph: {
    title: 'JobFlow AI — Turn Leads Into Jobs. Automatically.',
    description:
      'Stop losing customers because you were too busy to answer the phone. Lead capture, AI qualification, instant quotes and automatic follow-up for local service businesses.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available. Pinching to read a price on a quote is exactly what a
  // customer will do, and disabling it is an accessibility failure.
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8fafc' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
