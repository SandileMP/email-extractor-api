import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MeshParse — Email Extraction API',
  description: 'Extract email addresses from any website. One API call. Unlimited scale.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#07080f] text-white">{children}</body>
    </html>
  )
}
