// The document. Everything else is a route inside it.

import type { Metadata, Viewport } from 'next'
import { Providers } from '@/components/providers'
import { requestLocale } from '@/lib/i18n/server'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'Portta', template: '%s · Portta' },
  description: 'Administration panel for Portta',
  icons: { icon: '/favicon.svg' },
  // The panel is private software on somebody's machine. Nothing about it
  // belongs in an index, and a routed one should say so too.
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale()
  return (
    // `suppressHydrationWarning`: the blocking theme script writes the class
    // onto this element before React hydrates, which is the whole point — it
    // is what stops a light flash on a dark panel — and React would otherwise
    // report the difference it deliberately introduced.
    <html lang={locale} suppressHydrationWarning>
      <body className="h-full bg-bg text-ink antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  )
}
