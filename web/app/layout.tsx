import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'MeshParse — Web Intelligence Platform',
    template: '%s · MeshParse',
  },
  description: 'Extract contact emails, analyse SEO, and run email campaigns — all through a single developer-first API.',
  keywords: ['email extraction', 'web scraping', 'SEO analysis', 'email campaigns', 'lead generation', 'API'],
  authors: [{ name: 'MeshParse' }],
  creator: 'MeshParse',
  metadataBase: new URL('https://meshparse.com'),
  openGraph: {
    type: 'website',
    locale: 'en_ZA',
    url: 'https://meshparse.com',
    siteName: 'MeshParse',
    title: 'MeshParse — Web Intelligence Platform',
    description: 'Extract contact emails, analyse SEO, and run email campaigns — all through a single developer-first API.',
  },
  twitter: {
    card: 'summary',
    title: 'MeshParse — Web Intelligence Platform',
    description: 'Extract contact emails, analyse SEO, and run email campaigns.',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
    shortcut: '/favicon.svg',
  },
  manifest: '/site.webmanifest',
  themeColor: '#22c55e',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#07080f] text-white">{children}</body>
    </html>
  )
}
