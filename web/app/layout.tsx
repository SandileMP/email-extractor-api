import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Weblandr — Web Intelligence Platform',
    template: '%s · Weblandr',
  },
  description: 'Extract contact emails, analyse SEO, and run email campaigns — all through a single developer-first API.',
  keywords: ['email extraction', 'web scraping', 'SEO analysis', 'email campaigns', 'lead generation', 'API'],
  authors: [{ name: 'Weblandr' }],
  creator: 'Weblandr',
  metadataBase: new URL('https://weblandr.com'),
  openGraph: {
    type: 'website',
    locale: 'en_ZA',
    url: 'https://weblandr.com',
    siteName: 'Weblandr',
    title: 'Weblandr — Web Intelligence Platform',
    description: 'Extract contact emails, analyse SEO, and run email campaigns — all through a single developer-first API.',
  },
  twitter: {
    card: 'summary',
    title: 'Weblandr — Web Intelligence Platform',
    description: 'Extract contact emails, analyse SEO, and run email campaigns.',
  },
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/icon.svg',
    shortcut: '/favicon.svg',
  },
  manifest: '/site.webmanifest',
}

// themeColor moved to viewport export (Next.js 14+)
export const viewport: Viewport = {
  themeColor: '#22c55e',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#07080f] text-white">{children}</body>
    </html>
  )
}
