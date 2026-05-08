import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import { Toaster } from '@/components/Toaster';
import EarlyPermissionsPrompt from '@/components/EarlyPermissionsPrompt';
import ServiceWorkerRegister from '@/components/ServiceWorkerRegister';
import ViewportHeightManager from '@/components/ViewportHeightManager';

export const metadata: Metadata = {
  title: 'Canact',
  description: 'Community-first social-location app',
  applicationName: 'Canact',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Canact',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon-32.png',
    apple: '/apple-touch-icon.png',
  },
};
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, minimumScale: 1, userScalable: false, viewportFit: 'cover',
  themeColor: '#FFF8F8',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-[var(--canact-viewport-height)] w-screen max-w-[100vw] overflow-x-hidden bg-candy text-ink antialiased">
        <ViewportHeightManager />
        <AuthProvider>
          <EarlyPermissionsPrompt />
          <ServiceWorkerRegister />
          <div className="mx-auto max-w-screen-md md:max-w-screen-lg">
            {children}
          </div>
          <Toaster />
        </AuthProvider>
      </body>
    </html>
  );
}
