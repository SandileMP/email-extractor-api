import Link from 'next/link'

const features = [
  { icon: '⚡', title: 'Concurrent scraping', desc: 'Up to 50 URLs processed in parallel per request.' },
  { icon: '🔍', title: 'Contact page discovery', desc: 'Automatically finds /contact, /about, and navigation links.' },
  { icon: '✉️', title: 'Multi-method extraction', desc: 'Captures mailto: links and regex matches for maximum coverage.' },
  { icon: '🔒', title: 'Deduplicated & sorted', desc: 'Clean, lowercased, unique results every time.' },
  { icon: '🌐', title: 'Any website', desc: 'Works on any publicly accessible HTTP/HTTPS site.' },
  { icon: '📡', title: 'JSON API', desc: 'Simple REST endpoint. Integrate in minutes.' },
]

const REQUEST = `curl -X POST https://api.meshparse.com/emails \\
  -H "X-API-Key: sc_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://marble.restaurant/"]}'`

const RESPONSE = `{
  "emails": {
    "https://marble.restaurant/": [
      "info@marble.restaurant"
    ]
  }
}`

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-white/5 backdrop-blur sticky top-0 z-50 bg-zinc-950/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-bold text-lg tracking-tight">
            <span className="text-brand">MeshParse</span>
          </span>
          <div className="flex gap-3">
            <Link href="/login" className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors">
              Sign in
            </Link>
            <Link href="/signup" className="px-4 py-2 text-sm bg-brand text-black font-semibold rounded-lg hover:bg-green-400 transition-colors">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand/30 bg-brand/10 text-brand text-xs font-medium mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
          REST API · Live
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
          Extract emails from<br />
          <span className="text-brand">any website</span>
        </h1>
        <p className="text-xl text-zinc-400 mb-10 max-w-2xl mx-auto">
          One API call. Get every contact email from a site — including hidden contact pages.
          No scraping infrastructure to maintain.
        </p>
        <div className="flex gap-4 justify-center mb-16">
          <Link href="/signup" className="px-6 py-3 bg-brand text-black font-semibold rounded-lg hover:bg-green-400 transition-colors text-sm">
            Start free trial →
          </Link>
          <a href="#pricing" className="px-6 py-3 border border-white/10 rounded-lg hover:bg-white/5 transition-colors text-sm text-zinc-300">
            See pricing
          </a>
        </div>

        {/* Code demo */}
        <div className="grid md:grid-cols-2 gap-4 text-left max-w-4xl mx-auto">
          <div className="bg-zinc-900 rounded-xl border border-white/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
              <span className="w-3 h-3 rounded-full bg-zinc-700" />
              <span className="text-xs text-zinc-500 font-mono">Request</span>
            </div>
            <pre className="p-4 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">{REQUEST}</pre>
          </div>
          <div className="bg-zinc-900 rounded-xl border border-white/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
              <span className="w-3 h-3 rounded-full bg-zinc-700" />
              <span className="text-xs text-zinc-500 font-mono">Response</span>
            </div>
            <pre className="p-4 text-xs font-mono text-zinc-300 overflow-x-auto">{RESPONSE}</pre>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-6 py-20 border-t border-white/5">
        <h2 className="text-3xl font-bold text-center mb-12">Everything you need</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div key={f.title} className="p-6 rounded-xl bg-zinc-900 border border-white/5">
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="font-semibold mb-1">{f.title}</h3>
              <p className="text-sm text-zinc-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20 border-t border-white/5">
        <h2 className="text-3xl font-bold text-center mb-4">Simple pricing</h2>
        <p className="text-center text-zinc-400 mb-12">One plan. Everything included.</p>
        <div className="max-w-sm mx-auto">
          <div className="p-8 rounded-2xl bg-zinc-900 border border-brand/40 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-brand to-transparent" />
            <div className="text-sm text-brand font-medium mb-2">MeshParse Pro</div>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="text-5xl font-bold">R750</span>
              <span className="text-zinc-400">/month</span>
            </div>
            <ul className="space-y-3 mb-8 text-sm text-zinc-300">
              {[
                'Unlimited API calls',
                'Up to 50 URLs per request',
                'Concurrent processing',
                'Contact page discovery',
                'Email deduplication',
                'HTTPS endpoint',
                'API key management',
              ].map((feat) => (
                <li key={feat} className="flex items-center gap-2">
                  <span className="text-brand">✓</span> {feat}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full py-3 text-center bg-brand text-black font-semibold rounded-lg hover:bg-green-400 transition-colors text-sm"
            >
              Get started →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-zinc-500">
          <span className="font-semibold text-white">MeshParse</span>
          <span>© {new Date().getFullYear()} MeshParse. All rights reserved.</span>
          <a
            href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white transition-colors"
          >
            API Docs ↗
          </a>
        </div>
      </footer>
    </div>
  )
}
