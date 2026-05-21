import Link from 'next/link'

const STATS = [
  { value: '50+', label: 'URLs per request' },
  { value: '<1s', label: 'Avg response time' },
  { value: '3', label: 'Extraction methods' },
  { value: '100%', label: 'JSON API' },
]

const PRODUCTS = [
  {
    tag: 'Available now',
    tagColor: '#22c55e',
    icon: '✉️',
    title: 'Email Extraction',
    desc: 'Scrape contact emails from any public website. Automatically discovers contact pages, extracts from mailto links and plain text, deduplicates, and returns clean results.',
    features: ['Contact page discovery', '50 URLs per request', 'Deduplication & sorting', 'Concurrent processing'],
    cta: 'Start extracting',
    href: '/signup',
    live: true,
  },
  {
    tag: 'Available now',
    tagColor: '#06b6d4',
    icon: '📈',
    title: 'SEO Intelligence',
    desc: 'Audit any website for SEO performance. Analyse metadata, headings, images, Open Graph, structured data, and get a ranked list of actionable fixes.',
    features: ['On-page SEO audit', '100-pt scoring model', 'Deep multi-page crawl', 'Actionable issue list'],
    cta: 'Start auditing',
    href: '/signup',
    live: true,
  },
  {
    tag: 'Coming soon',
    tagColor: '#a855f7',
    icon: '📣',
    title: 'Email Campaigns',
    desc: 'Build and send targeted campaigns to your extracted contact lists. Design templates, track opens and clicks, and automate follow-up sequences.',
    features: ['Drag-and-drop builder', 'Open & click tracking', 'Automated sequences', 'List segmentation'],
    cta: 'Join waitlist',
    href: '/signup',
    live: false,
  },
]

const USE_CASES = [
  { icon: '🎯', title: 'Lead generation', desc: 'Build qualified prospect lists from industry directories, event sites, and company pages.' },
  { icon: '🔬', title: 'Market research', desc: 'Gather contact data at scale to understand market landscapes and competitive positioning.' },
  { icon: '🤝', title: 'Partnership outreach', desc: 'Find the right contacts at target companies for business development campaigns.' },
  { icon: '📊', title: 'Data enrichment', desc: 'Enrich your existing CRM with missing email addresses from company websites.' },
  { icon: '⚡', title: 'Developer workflows', desc: 'Drop the API into any pipeline — Python, Node, Ruby, or any HTTP client.' },
  { icon: '🏢', title: 'Agency tooling', desc: 'Power your client deliverables with reliable, scalable contact data extraction.' },
]

const REQUEST = `curl -X POST \\
  https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/emails \\
  -H "X-API-Key: mp_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://marble.restaurant/",
           "https://aurumrestaurant.co.za/"]}'`

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

      {/* ── Nav ─────────────────────────────────────────── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 backdrop-blur-xl bg-[#07080f]/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="MeshParse" className="w-7 h-7" />
            <span className="font-bold text-lg tracking-tight">MeshParse</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-zinc-400">
            <a href="#platform" className="hover:text-white transition-colors">Platform</a>
            <a href="#use-cases" className="hover:text-white transition-colors">Use cases</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">API Docs ↗</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm text-zinc-400 hover:text-white transition-colors px-3 py-2">Sign in</Link>
            <Link href="/signup" className="text-sm bg-emerald-500 hover:bg-emerald-400 text-black font-bold px-4 py-2 rounded-lg transition-colors">
              Get started →
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative pt-32 pb-0 overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #07080f 0%, #071a14 40%, #07080f 100%)' }}>
        {/* Glow */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] rounded-full opacity-20 blur-[130px]"
          style={{ background: 'radial-gradient(ellipse, #22c55e 0%, transparent 65%)' }} />
        <div className="absolute top-10 right-0 w-96 h-96 rounded-full opacity-8 blur-[100px]" style={{ background: '#06b6d4' }} />

        <div className="relative max-w-7xl mx-auto px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-bold mb-8 tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Web Intelligence Platform
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black tracking-tight leading-[0.9] mb-6">
            <span className="block text-white">The data engine</span>
            <span className="block mt-2" style={{
              background: 'linear-gradient(90deg, #22c55e 0%, #06b6d4 60%, #22c55e 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundSize: '200%',
            }}>
              for modern marketers
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-zinc-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            Extract contacts, analyse SEO, and run email campaigns —
            {' '}<span className="text-zinc-200">all through a single developer-first API.</span>
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/signup"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-bold text-black rounded-xl transition-all hover:opacity-90"
              style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
              Start for free
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </Link>
            <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 text-base font-semibold rounded-xl border border-white/10 hover:border-white/20 hover:bg-white/5 transition-all text-zinc-300">
              Explore the API ↗
            </a>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap justify-center gap-10 pb-20">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <div className="text-3xl font-black text-white">{s.value}</div>
                <div className="text-xs text-zinc-500 uppercase tracking-widest mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Wave */}
        <div style={{ marginBottom: '-2px' }}>
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 80V40C240 0 480 60 720 40C960 20 1200 60 1440 40V80H0Z" fill="#0d0f1a"/>
          </svg>
        </div>
      </section>

      {/* ── Platform ─────────────────────────────────────── */}
      <section id="platform" className="bg-[#0d0f1a] py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-500 mb-3 block">Platform</span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">One platform. Multiple superpowers.</h2>
            <p className="text-zinc-400 max-w-xl mx-auto">
              Start with email extraction today. SEO intelligence and campaign tools are on the way.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {PRODUCTS.map((p) => (
              <div key={p.title}
                className="rounded-2xl border border-white/5 p-8 flex flex-col hover:border-white/10 transition-all"
                style={{ background: 'linear-gradient(145deg, #0a0c14, #070810)' }}>
                {/* Tag */}
                <div className="flex items-center justify-between mb-6">
                  <span className="text-2xl">{p.icon}</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border"
                    style={{ color: p.tagColor, borderColor: `${p.tagColor}30`, background: `${p.tagColor}10` }}>
                    {p.tag}
                  </span>
                </div>

                <h3 className="text-xl font-bold mb-3">{p.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed mb-6 flex-1">{p.desc}</p>

                <ul className="space-y-2 mb-8">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
                      <span className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center text-[9px]"
                        style={{ background: `${p.tagColor}15`, border: `1px solid ${p.tagColor}30`, color: p.tagColor }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {p.live ? (
                  <Link href={p.href}
                    className="block text-center py-3 rounded-xl text-sm font-bold text-black transition-all hover:opacity-90"
                    style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
                    {p.cta} →
                  </Link>
                ) : (
                  <Link href={p.href}
                    className="block text-center py-3 rounded-xl text-sm font-semibold border transition-colors hover:bg-white/5"
                    style={{ borderColor: `${p.tagColor}30`, color: p.tagColor }}>
                    {p.cta} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Code demo ──────────────────────────────────────── */}
      <section className="py-24 bg-[#07080f]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-500 mb-3 block">Developer-first</span>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Integrate in minutes</h2>
            <p className="text-zinc-400">Works with any HTTP client — Python, Node, Ruby, PHP, curl</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 max-w-5xl mx-auto">
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

      {/* ── Use cases ───────────────────────────────────────── */}
      <section id="use-cases" className="py-24 bg-[#0d0f1a]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-500 mb-3 block">Use cases</span>
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Built for growth teams</h2>
            <p className="text-zinc-400 max-w-xl mx-auto">Whether you're a developer, marketer, or founder — MeshParse fits your workflow</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {USE_CASES.map(u => (
              <div key={u.title}
                className="p-7 rounded-2xl border border-white/5 hover:border-emerald-500/15 hover:-translate-y-0.5 transition-all"
                style={{ background: 'linear-gradient(135deg, #0a0c14, #070810)' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl mb-5"
                  style={{ background: '#22c55e12', border: '1px solid #22c55e20' }}>
                  {u.icon}
                </div>
                <h3 className="font-bold mb-2">{u.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{u.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="py-24 relative overflow-hidden bg-[#07080f]">
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[700px] h-[400px] rounded-full blur-[150px] opacity-10"
            style={{ background: 'radial-gradient(ellipse, #22c55e, transparent 70%)' }} />
        </div>
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-500 mb-3 block">Pricing</span>
            <h2 className="text-3xl md:text-4xl font-bold mb-3">Simple, flat pricing</h2>
            <p className="text-zinc-400">No per-call billing. No hidden fees. Cancel anytime.</p>
          </div>

          <div className="max-w-md mx-auto">
            <div className="relative rounded-3xl p-[1px]"
              style={{ background: 'linear-gradient(135deg, #22c55e50, #06b6d430, #22c55e10)' }}>
              <div className="rounded-3xl p-9" style={{ background: 'linear-gradient(145deg, #0d1a12, #0a0f1e)' }}>
                <div className="flex items-center justify-between mb-6">
                  <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Pro Plan</span>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">All features included</span>
                </div>
                <div className="flex items-end gap-2 mb-2">
                  <span className="text-6xl font-black">R750</span>
                  <span className="text-zinc-500 mb-2 text-lg">/mo</span>
                </div>
                <p className="text-sm text-zinc-500 mb-8">Access to all current and future platform features</p>

                <ul className="space-y-3 mb-8">
                  {[
                    ['✉️', 'Email Extraction API', true],
                    ['📈', 'SEO Intelligence', true],
                    ['📣', 'Email Campaigns', false],
                    ['🔑', 'API key management', true],
                    ['⚡', 'Unlimited API calls', true],
                    ['🛠️', 'Developer documentation', true],
                  ].map(([icon, label, live]) => (
                    <li key={label as string} className="flex items-center gap-3 text-sm">
                      <span className="text-base">{icon}</span>
                      <span className={live ? 'text-zinc-200' : 'text-zinc-500'}>{label as string}</span>
                      {!live && (
                        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/20 text-cyan-500 bg-cyan-500/5">Soon</span>
                      )}
                    </li>
                  ))}
                </ul>

                <Link href="/signup"
                  className="block w-full py-4 text-center font-bold text-black rounded-xl transition-all hover:opacity-90 text-sm"
                  style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
                  Get started today →
                </Link>
                <p className="text-center text-xs text-zinc-600 mt-3">No credit card required to sign up</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────── */}
      <section className="py-24 bg-[#0d0f1a]">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-4xl md:text-5xl font-black mb-4">
            Your growth stack
            <span className="block mt-1" style={{
              background: 'linear-gradient(90deg, #22c55e, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>starts here</span>
          </h2>
          <p className="text-zinc-400 text-lg mb-8 max-w-xl mx-auto">
            Start with email extraction. Scale with SEO and campaigns. One platform, one subscription.
          </p>
          <Link href="/signup"
            className="inline-flex items-center gap-2 px-10 py-4 font-bold text-black rounded-xl text-base transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
            Create free account →
          </Link>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-10 bg-[#07080f]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="MeshParse" className="w-6 h-6" />
            <span className="font-bold text-sm">MeshParse</span>
            <span className="text-xs text-zinc-700 ml-1">· Web Intelligence Platform</span>
          </div>
          <span className="text-xs text-zinc-700">© {new Date().getFullYear()} MeshParse · Built on AWS · Secured by Supabase</span>
          <div className="flex items-center gap-6 text-xs text-zinc-500">
            <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">API Docs ↗</a>
            <Link href="/login" className="hover:text-white transition-colors">Sign in</Link>
            <Link href="/signup" className="hover:text-white transition-colors">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
