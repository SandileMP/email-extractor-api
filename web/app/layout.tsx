import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Scrapify — Email Extraction API',
  description: 'Extract email addresses from any website. Simple API, one flat price.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  )
}
