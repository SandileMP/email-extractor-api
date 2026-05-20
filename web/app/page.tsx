import Link from 'next/link'

const STATS = [
  { value: '50', label: 'URLs per request' },
  { value: '<1s', label: 'Avg response time' },
  { value: '3×', label: 'Extraction methods' },
  { value: '100%', label: 'JSON responses' },
]

const STEPS = [
  { n: '01', title: 'Sign up', desc: 'Create your account in seconds. No credit card required to start.' },
  { n: '02', title: 'Subscribe', desc: 'One flat plan — R750/month. Unlimited calls, no metered billing.' },
  { n: '03', title: 'Start scraping', desc: 'Drop your API key into any HTTP client and go.' },
]

const FEATURES = [
  { icon: '⚡', title: 'Concurrent processing', desc: 'All URLs in your request run in parallel — 50 at once.' },
  { icon: '🔍', title: 'Contact page discovery', desc: 'Automatically navigates to /contact, /about and nav links.' },
  { icon: '✉️', title: 'Dual extraction', desc: 'Captures mailto: links and plain-text regex matches.' },
  { icon: '🔒', title: 'Clean output', desc: 'Lowercased, deduplicated, alphabetically sorted results.' },
  { icon: '🌐', title: 'Any public site', desc: 'Works on any HTTP/HTTPS website with no configuration.' },
  { icon: '🔑', title: 'Secure API keys', desc: 'Every subscription gets a unique API key, revocable instantly.' },
]

const REQUEST = `curl -X POST \\
  https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/emails \\
  -H "X-API-Key: mp_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"urls": [
    "https://marble.restaurant/",
    "https://aurumrestaurant.co.za/"
  ]}'`

const RESPONSE = `{
  "emails": {
    "https://marble.restaurant/": [
      "info@marble.restaurant"
    ],
    "https://aurumrestaurant.co.za/": [
      "bookings@aurumrestaurant.co.za"
    ]
  }
}`

export default function Home() {
  return (
    <div className="min-h-screen bg-[#07080f] text-white">

      {/* ── Nav ───────────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-[#07080f]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-[11px] font-black text-black">M</div>
            <span className="font-bold text-lg tracking-tight">MeshParse</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Docs ↗</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-2">
              Sign in
            </Link>
            <Link href="/signup" className="text-sm bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-4 py-2 rounded-lg transition-colors">
              Get started →
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section
        className="relative pt-32 pb-0 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #07080f 0%, #071a14 40%, #07080f 100%)' }}
      >
        {/* Glow blobs */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full opacity-20 blur-[120px]"
          style={{ background: 'radial-gradient(ellipse, #22c55e 0%, transparent 70%)' }} />
        <div className="absolute top-10 right-0 w-80 h-80 rounded-full opacity-10 blur-[100px]"
          style={{ background: '#06b6d4' }} />

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-semibold mb-8 tracking-wider uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            REST API · Production-ready
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight mb-6 leading-[0.9]">
            <span className="block text-white">Extract Emails</span>
            <span className="block mt-2" style={{
              background: 'linear-gradient(90deg, #22c55e, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              From Any Website
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            One API call. Get every contact email — including hidden contact pages.{' '}
            <span className="text-zinc-200">No infrastructure to manage.</span>
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/signup"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold text-black rounded-xl transition-all"
              style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
              Start scraping today
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-zinc-300">
              View API docs ↗
            </a>
          </div>

          {/* Stats strip */}
          <div className="flex flex-wrap justify-center gap-8 pb-20">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-black text-white">{s.value}</div>
                <div className="text-xs text-zinc-500 uppercase tracking-wider mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Wave */}
        <div className="relative" style={{ marginBottom: '-2px' }}>
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 80V40C240 0 480 60 720 40C960 20 1200 60 1440 40V80H0Z" fill="#0d0f1a"/>
          </svg>
        </div>
      </section>

      {/* ── Code demo ─────────────────────────────────────────── */}
      <section className="bg-[#0d0f1a] py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Simple as a curl command</h2>
            <p className="text-zinc-400">Integrate in minutes with any language or tool</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 max-w-5xl mx-auto">
            {/* Request */}
            <div className="rounded-2xl overflow-hidden border border-white/5" style={{ background: '#0a0c14' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/60" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <span className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <span className="text-xs text-zinc-600 font-mono">request.sh</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">POST</span>
              </div>
              <pre className="p-5 text-[13px] font-mono text-emerald-400 overflow-x-auto leading-relaxed">{REQUEST}</pre>
            </div>

            {/* Response */}
            <div className="rounded-2xl overflow-hidden border border-white/5" style={{ background: '#0a0c14' }}>
              <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
                <div className="flex gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-red-500/60" />
                  <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
                  <span className="w-3 h-3 rounded-full bg-green-500/60" />
                </div>
                <span className="text-xs text-zinc-600 font-mono">response.json</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">200 OK</span>
              </div>
              <pre className="p-5 text-[13px] font-mono text-zinc-300 overflow-x-auto leading-relaxed">{RESPONSE}</pre>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────── */}
      <section id="how-it-works" className="py-24" style={{ background: '#07080f' }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-3 block">Process</span>
            <h2 className="text-3xl md:text-4xl font-bold">Up and running in minutes</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8 relative">
            {/* Connector line */}
            <div className="hidden md:block absolute top-8 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-emerald-500/30 to-transparent" />
            {STEPS.map((s) => (
              <div key={s.n} className="relative p-8 rounded-2xl border border-white/5 hover:border-emerald-500/20 transition-colors group"
                style={{ background: 'linear-gradient(135deg, #0d0f1a, #0a0c14)' }}>
                <div className="text-5xl font-black mb-4" style={{
                  background: 'linear-gradient(135deg, #22c55e20, #06b6d420)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}>
                  {s.n}
                </div>
                <div className="absolute top-8 right-8 text-4xl font-black text-emerald-500/10 group-hover:text-emerald-500/20 transition-colors select-none">{s.n}</div>
                <h3 className="text-xl font-bold mb-2">{s.title}</h3>
                <p className="text-zinc-400 text-sm leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────── */}
      <section id="features" className="py-24 bg-[#0d0f1a]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-3 block">Features</span>
            <h2 className="text-3xl md:text-4xl font-bold">Everything you need</h2>
            <p className="text-zinc-400 mt-3 max-w-xl mx-auto">Built for developers who need reliable email data at scale</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title}
                className="p-7 rounded-2xl border border-white/5 hover:border-emerald-500/20 transition-all hover:-translate-y-0.5 group"
                style={{ background: 'linear-gradient(135deg, #0a0c14, #070810)' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-5"
                  style={{ background: 'linear-gradient(135deg, #22c55e15, #06b6d415)', border: '1px solid #22c55e20' }}>
                  {f.icon}
                </div>
                <h3 className="font-bold mb-2 text-white">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────── */}
      <section id="pricing" className="py-24 relative overflow-hidden" style={{ background: '#07080f' }}>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[600px] h-[400px] rounded-full blur-[140px] opacity-10"
            style={{ background: 'radial-gradient(ellipse, #22c55e, transparent 70%)' }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <span className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-3 block">Pricing</span>
            <h2 className="text-3xl md:text-4xl font-bold">One plan. No surprises.</h2>
            <p className="text-zinc-400 mt-3">Unlimited API calls. Flat monthly rate.</p>
          </div>

          <div className="max-w-sm mx-auto">
            <div className="relative rounded-3xl p-[1px] overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #22c55e40, #06b6d420, #22c55e10)' }}>
              <div className="rounded-3xl p-8" style={{ background: 'linear-gradient(135deg, #0d1a12, #0a0f1e)' }}>
                <div className="text-xs font-bold uppercase tracking-widest text-emerald-400 mb-4">MeshParse Pro</div>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-6xl font-black">R750</span>
                  <span className="text-zinc-500 mb-2">/month</span>
                </div>
                <p className="text-sm text-zinc-500 mb-8">All features. No usage caps.</p>

                <ul className="space-y-3 mb-8">
                  {[
                    'Unlimited API calls',
                    'Up to 50 URLs per request',
                    'Parallel processing',
                    'Contact page discovery',
                    'Email deduplication',
                    'Supabase-backed auth',
                    'HTTPS endpoint',
                    'API key management',
                  ].map(f => (
                    <li key={f} className="flex items-center gap-3 text-sm text-zinc-300">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                        style={{ background: '#22c55e20', border: '1px solid #22c55e40', color: '#22c55e' }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <Link href="/signup"
                  className="block w-full py-4 text-center font-bold text-black rounded-xl transition-all text-sm"
                  style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
                  Get started today →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA Banner ────────────────────────────────────────── */}
      <section className="py-20 relative overflow-hidden" style={{ background: '#0d0f1a' }}>
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-black mb-4">
            Ready to start{' '}
            <span style={{
              background: 'linear-gradient(90deg, #22c55e, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
              scraping?
            </span>
          </h2>
          <p className="text-zinc-400 text-lg mb-8">Join developers extracting contact data at scale.</p>
          <Link href="/signup"
            className="inline-flex items-center gap-2 px-10 py-4 font-bold text-black rounded-xl text-base transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
            Create free account →
          </Link>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10" style={{ background: '#07080f' }}>
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-[10px] font-black text-black">M</div>
            <span className="font-bold text-sm">MeshParse</span>
          </div>
          <span className="text-xs text-zinc-600">© {new Date().getFullYear()} MeshParse · Built on AWS · Secured by Supabase</span>
          <div className="flex items-center gap-6 text-xs text-zinc-500">
            <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs"
              target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
              API Docs ↗
            </a>
            <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
            <Link href="/signup" className="hover:text-white transition-colors">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
