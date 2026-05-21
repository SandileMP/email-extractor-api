'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import type { User } from '@supabase/supabase-js'

const API = 'https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com'
const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL!

// ── Types ─────────────────────────────────────────────────────────────────

interface Issue { severity: string; code: string; message: string; fix?: string }
interface SeoScan {
  scan_id: string; url: string; score: number; status: string
  cached: boolean; pages_scanned: number; depth: number; created_at: string
  results: {
    meta: {
      title: string; title_length: number; title_optimal: boolean
      description: string; description_length: number; description_optimal: boolean
      canonical: string; has_viewport: boolean; robots: string
    }
    headings: { h1_count: number; h1_texts: string[]; h2_count: number; h3_count: number }
    images: { total: number; missing_alt: number; alt_coverage: number }
    open_graph: { has_og_title: boolean; has_og_description: boolean; has_og_image: boolean; has_og_url: boolean }
    technical: {
      status_code: number; response_time_ms: number; page_size_bytes: number
      is_https: boolean; has_robots_txt: boolean; has_sitemap: boolean; has_schema_markup: boolean
    }
    content: { word_count: number; text_html_ratio: number }
    issues: Issue[]
    score: number
  }
  pages?: Array<{ url: string; score: number; status: string }>
}

// ── Sub-components ────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 44
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#f59e0b' : score >= 40 ? '#f97316' : '#ef4444'
  const label = score >= 80 ? 'Good' : score >= 60 ? 'Fair' : score >= 40 ? 'Poor' : 'Critical'
  return (
    <div className="relative flex items-center justify-center w-32 h-32">
      <svg width="128" height="128" className="-rotate-90 absolute inset-0">
        <circle cx="64" cy="64" r={r} fill="none" stroke="#1f2937" strokeWidth="9"/>
        <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="9"
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.6s ease' }}/>
      </svg>
      <div className="flex flex-col items-center z-10">
        <span className="text-3xl font-black" style={{ color }}>{score}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{label}</span>
      </div>
    </div>
  )
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high:     'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium:   'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low:      'text-zinc-400 bg-zinc-800 border-zinc-700',
}

function Pill({ text, ok }: { text: string; ok: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
      ok ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
         : 'text-red-400 bg-red-500/10 border-red-500/20'
    }`}>{text}</span>
  )
}

function StatRow({ label, value, ok }: { label: string; value: string | number; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className={`text-sm font-semibold ${ok === false ? 'text-red-400' : ok === true ? 'text-emerald-400' : 'text-zinc-200'}`}>
        {String(value)}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [subStatus, setSubStatus] = useState('inactive')
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  // SEO scanner state
  const [tab, setTab] = useState<'overview' | 'seo'>('overview')
  const [seoUrl, setSeoUrl] = useState('')
  const [depth, setDepth] = useState(1)
  const [maxPages, setMaxPages] = useState(5)
  const [forceRescan, setForceRescan] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [seoResult, setSeoResult] = useState<SeoScan | null>(null)
  const [seoError, setSeoError] = useState('')
  const [seoHistory, setSeoHistory] = useState<SeoScan[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const loadHistory = useCallback(async (key: string) => {
    setHistoryLoading(true)
    try {
      const res = await fetch(`${API}/seo/scans?limit=10`, {
        headers: { 'X-API-Key': key },
      })
      if (res.ok) {
        const data = await res.json()
        setSeoHistory(data.scans || [])
      }
    } catch { /* silent */ }
    setHistoryLoading(false)
  }, [])

  useEffect(() => {
    const supabase = createClient()
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const [{ data: keys }, { data: subs }] = await Promise.all([
        supabase.from('api_keys').select('api_key').eq('user_id', session.user.id).eq('active', true).order('created_at', { ascending: false }).limit(1),
        supabase.from('subscriptions').select('status').eq('user_id', session.user.id).order('updated_at', { ascending: false }).limit(1),
      ])
      const key = keys?.[0]?.api_key ?? null
      setApiKey(key)
      setSubStatus(subs?.[0]?.status ?? 'inactive')
      setLoading(false)
      if (key) loadHistory(key)
    }
    load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(e => {
      if (e === 'SIGNED_OUT') router.push('/')
    })
    return () => subscription.unsubscribe()
  }, [router, loadHistory])

  async function subscribe() {
    if (!user) return
    setCheckingOut(true)
    try {
      const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, user_id: user.id }),
      })
      const { url, error } = await res.json()
      if (url) window.location.href = url
      else { showToast(error ?? 'Could not start checkout', 'error'); setCheckingOut(false) }
    } catch { showToast('Could not reach checkout', 'error'); setCheckingOut(false) }
  }

  async function cancelSubscription() {
    if (!user || !confirm('Cancel your subscription? Your API key will be deactivated.')) return
    setCancelling(true)
    try {
      const res = await fetch(`${API}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      const data = await res.json()
      if (data.cancelled) { setSubStatus('inactive'); setApiKey(null); showToast('Subscription cancelled') }
      else showToast(data.error ?? 'Could not cancel', 'error')
    } catch { showToast('Could not reach cancellation service', 'error') }
    setCancelling(false)
  }

  async function runSeoScan() {
    if (!apiKey || !seoUrl.trim()) return
    setSeoError('')
    setSeoResult(null)
    setScanning(true)
    setExpandedSection(null)
    try {
      const res = await fetch(`${API}/seo/scan`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: seoUrl.trim(), depth, max_pages: maxPages, force: forceRescan }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setSeoError(data.error || `HTTP ${res.status}`)
      } else {
        setSeoResult(data)
        loadHistory(apiKey)
      }
    } catch (e) { setSeoError('Request failed — check the URL and try again') }
    setScanning(false)
  }

  async function copyKey() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function logout() {
    await createClient().auth.signOut(); router.push('/')
  }

  const isActive = subStatus === 'active'
  const maskedKey = apiKey ? `${apiKey.slice(0, 14)}${'•'.repeat(20)}` : null

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#07080f' }}>
      <div className="w-8 h-8 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen" style={{ background: '#07080f' }}>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border ${
          toast.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                   : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>{toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}</div>
      )}

      {/* Nav */}
      <nav className="border-b border-white/5 sticky top-0 z-40 backdrop-blur-xl" style={{ background: '#07080f99' }}>
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/icon.svg" alt="MeshParse" className="w-7 h-7" />
            <span className="font-bold">MeshParse</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500 hidden sm:block">{user?.email}</span>
            <button onClick={logout} className="text-sm text-zinc-400 hover:text-white transition-colors">Sign out</button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {/* Header + tabs */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
            isActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                     : 'bg-zinc-800 border-zinc-700 text-zinc-500'
          }`}>{isActive ? '● Active' : '○ Inactive'}</span>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 p-1 rounded-xl mb-8 w-fit" style={{ background: '#0d0f1a' }}>
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'seo', label: 'SEO Scanner', badge: isActive },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}>
              {t.label}
              {t.id === 'seo' && !isActive && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 font-bold">NEW</span>
              )}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <div className="space-y-6">
            {/* Status cards */}
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { label: 'Plan', value: isActive ? 'MeshParse Pro' : 'No plan' },
                { label: 'Billing', value: isActive ? 'R750 / month' : '—' },
                { label: 'Status', value: isActive ? 'Active' : 'Inactive' },
              ].map(c => (
                <div key={c.label} className="p-5 rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{c.label}</p>
                  <p className="font-semibold">{c.value}</p>
                </div>
              ))}
            </div>

            {/* API key */}
            <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <h2 className="font-semibold">API Key</h2>
                {apiKey && (
                  <div className="flex gap-2">
                    <button onClick={() => setShowKey(v => !v)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-zinc-400">
                      {showKey ? 'Hide' : 'Reveal'}
                    </button>
                    <button onClick={copyKey}
                      className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-zinc-400">
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
              <div className="px-6 py-5">
                {apiKey ? (
                  <div className="font-mono text-sm text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-4 py-3 break-all">
                    {showKey ? apiKey : maskedKey}
                  </div>
                ) : (
                  <div className="text-center py-6">
                    {isActive
                      ? <p className="text-sm text-zinc-400">Your API key is being provisioned…</p>
                      : (
                        <div>
                          <p className="text-sm text-zinc-400 mb-4">Subscribe to unlock your API key and all features</p>
                          <button onClick={subscribe} disabled={checkingOut}
                            className="px-6 py-2.5 font-bold text-black rounded-xl text-sm disabled:opacity-50"
                            style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)' }}>
                            {checkingOut ? 'Redirecting…' : 'Subscribe — R750/month →'}
                          </button>
                        </div>
                      )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick start */}
            {apiKey && (
              <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                  <h2 className="font-semibold">Quick start</h2>
                  <span className="text-xs text-zinc-500">Email extraction</span>
                </div>
                <pre className="p-6 text-[13px] font-mono text-emerald-400 overflow-x-auto leading-relaxed">{`curl -X POST ${API}/emails \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'mp_live_your_key'}" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'`}</pre>
              </div>
            )}

            {/* Links */}
            <div className="grid sm:grid-cols-2 gap-4">
              <a href={`${API}/docs`} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between p-5 rounded-xl border border-white/5 hover:border-white/10 transition-colors group"
                style={{ background: '#0d0f1a' }}>
                <div>
                  <p className="font-semibold text-sm mb-0.5">API Documentation</p>
                  <p className="text-xs text-zinc-500">Swagger UI for all endpoints</p>
                </div>
                <span className="text-zinc-500 group-hover:text-white transition-colors">↗</span>
              </a>
              <button onClick={() => setTab('seo')}
                className="flex items-center justify-between p-5 rounded-xl border border-emerald-500/20 hover:border-emerald-500/30 transition-colors text-left group"
                style={{ background: 'linear-gradient(135deg,#0d1a12,#0a0f1e)' }}>
                <div>
                  <p className="font-semibold text-sm mb-0.5 text-emerald-400">SEO Scanner ✨</p>
                  <p className="text-xs text-zinc-500">Audit any website for SEO issues</p>
                </div>
                <span className="text-emerald-500 group-hover:text-emerald-400 transition-colors">→</span>
              </button>
            </div>

            {/* Danger zone */}
            {isActive && (
              <div className="rounded-xl border border-red-500/10 p-6" style={{ background: '#0d0f1a' }}>
                <h3 className="font-semibold text-sm mb-1 text-red-400">Danger zone</h3>
                <p className="text-xs text-zinc-500 mb-4">Cancelling will immediately deactivate your API key. You can resubscribe at any time.</p>
                <button onClick={cancelSubscription} disabled={cancelling}
                  className="text-sm px-4 py-2 rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors">
                  {cancelling ? 'Cancelling…' : 'Cancel subscription'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── SEO SCANNER TAB ─────────────────────────────────────────── */}
        {tab === 'seo' && (
          <div className="space-y-6">
            {!isActive && (
              <div className="rounded-xl border border-emerald-500/20 p-6 flex items-center gap-4"
                style={{ background: 'linear-gradient(135deg,#0d1a12,#0a0f1e)' }}>
                <span className="text-3xl">📈</span>
                <div className="flex-1">
                  <p className="font-semibold mb-1">SEO Scanner requires an active subscription</p>
                  <p className="text-sm text-zinc-400">Subscribe to get your API key and start scanning.</p>
                </div>
                <button onClick={subscribe} disabled={checkingOut}
                  className="flex-shrink-0 px-5 py-2 font-bold text-black rounded-lg text-sm"
                  style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)' }}>
                  Subscribe →
                </button>
              </div>
            )}

            {/* Scan form */}
            <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
              <div className="px-6 py-4 border-b border-white/5">
                <h2 className="font-semibold">SEO Scanner</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Audit any public website for SEO health, score, and actionable issues</p>
              </div>
              <div className="p-6 space-y-5">
                {/* URL input */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Website URL</label>
                  <input
                    type="url"
                    value={seoUrl}
                    onChange={e => setSeoUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && isActive && apiKey && runSeoScan()}
                    placeholder="https://example.com"
                    className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                    style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}
                    onFocus={e => e.target.style.borderColor = '#22c55e40'}
                    onBlur={e => e.target.style.borderColor = '#ffffff10'}
                  />
                </div>

                {/* Options row */}
                <div className="flex flex-wrap gap-4">
                  {/* Depth */}
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Audit depth</label>
                    <div className="flex rounded-lg overflow-hidden border border-white/10">
                      {[
                        { value: 1, label: 'Homepage' },
                        { value: 2, label: 'Deep' },
                      ].map(d => (
                        <button key={d.value} onClick={() => setDepth(d.value)}
                          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                            depth === d.value ? 'bg-emerald-500 text-black' : 'text-zinc-400 hover:text-white bg-transparent'
                          }`}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Max pages (only for deep) */}
                  {depth === 2 && (
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">
                        Max pages <span className="text-zinc-600 normal-case font-normal">(2–10)</span>
                      </label>
                      <input type="number" min={2} max={10} value={maxPages}
                        onChange={e => setMaxPages(Math.min(10, Math.max(2, +e.target.value)))}
                        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
                        style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                    </div>
                  )}

                  {/* Force rescan */}
                  <div className="flex items-end pb-0.5">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div className={`w-9 h-5 rounded-full relative transition-colors ${forceRescan ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                        onClick={() => setForceRescan(v => !v)}>
                        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${forceRescan ? 'translate-x-4' : 'translate-x-0.5'}`}/>
                      </div>
                      <span className="text-sm text-zinc-400">Force fresh scan</span>
                    </label>
                  </div>
                </div>

                <button
                  onClick={runSeoScan}
                  disabled={scanning || !isActive || !apiKey || !seoUrl.trim()}
                  className="w-full py-3.5 font-bold text-sm rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)', color: '#000' }}>
                  {scanning
                    ? <><span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"/>
                        {depth === 2 ? `Crawling up to ${maxPages} pages…` : 'Scanning…'}</>
                    : '→ Run SEO Scan'}
                </button>

                {seoError && (
                  <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">{seoError}</p>
                )}
              </div>
            </div>

            {/* Results */}
            {seoResult && (
              <div className="space-y-4">
                {/* Score card */}
                <div className="rounded-xl border border-white/5 p-6" style={{ background: '#0d0f1a' }}>
                  <div className="flex flex-col sm:flex-row items-center gap-6">
                    <ScoreRing score={seoResult.score} />
                    <div className="flex-1 text-center sm:text-left">
                      <div className="text-sm text-zinc-400 mb-1 truncate">{seoResult.url}</div>
                      <div className="flex flex-wrap gap-2 justify-center sm:justify-start mb-3">
                        <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                          {seoResult.pages_scanned} page{seoResult.pages_scanned !== 1 ? 's' : ''} scanned
                        </span>
                        {seoResult.cached && (
                          <span className="text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">Cached</span>
                        )}
                        <span className="text-xs px-2.5 py-1 rounded-full bg-white/5 text-zinc-400 border border-white/10">
                          {seoResult.results.technical.response_time_ms}ms
                        </span>
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${
                          seoResult.results.technical.is_https
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>{seoResult.results.technical.is_https ? '🔒 HTTPS' : '⚠ HTTP'}</span>
                      </div>
                      <div className="text-sm text-zinc-500">
                        {seoResult.results.issues.length === 0
                          ? '✅ No issues found!'
                          : `${seoResult.results.issues.length} issue${seoResult.results.issues.length !== 1 ? 's' : ''} found`}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Issues */}
                {seoResult.results.issues.length > 0 && (
                  <div className="rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0d0f1a' }}>
                    <div className="px-6 py-4 border-b border-white/5">
                      <h3 className="font-semibold">Issues</h3>
                    </div>
                    <div className="divide-y divide-white/5">
                      {seoResult.results.issues.map((issue, i) => (
                        <div key={i} className="px-6 py-4">
                          <div className="flex items-start gap-3">
                            <span className={`flex-shrink-0 text-[10px] font-bold uppercase px-2 py-1 rounded-full border mt-0.5 ${SEVERITY_STYLE[issue.severity] || SEVERITY_STYLE.low}`}>
                              {issue.severity}
                            </span>
                            <div>
                              <p className="text-sm text-zinc-200">{issue.message}</p>
                              {issue.fix && <p className="text-xs text-zinc-500 mt-1">Fix: {issue.fix}</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Breakdown panels */}
                {[
                  {
                    id: 'meta', label: 'Meta & Title',
                    rows: [
                      { label: 'Title', value: seoResult.results.meta.title || '—', ok: !!seoResult.results.meta.title },
                      { label: 'Title length', value: `${seoResult.results.meta.title_length} chars`, ok: seoResult.results.meta.title_optimal },
                      { label: 'Description', value: seoResult.results.meta.description ? `${seoResult.results.meta.description_length} chars` : 'Missing', ok: !!seoResult.results.meta.description },
                      { label: 'Canonical', value: seoResult.results.meta.canonical || 'Not set', ok: !!seoResult.results.meta.canonical },
                      { label: 'Viewport', value: seoResult.results.meta.has_viewport ? 'Set' : 'Missing', ok: seoResult.results.meta.has_viewport },
                    ],
                  },
                  {
                    id: 'headings', label: 'Headings',
                    rows: [
                      { label: 'H1 count', value: seoResult.results.headings.h1_count, ok: seoResult.results.headings.h1_count === 1 },
                      { label: 'H1 text', value: seoResult.results.headings.h1_texts[0] || '—' },
                      { label: 'H2 count', value: seoResult.results.headings.h2_count },
                      { label: 'H3 count', value: seoResult.results.headings.h3_count },
                    ],
                  },
                  {
                    id: 'technical', label: 'Technical',
                    rows: [
                      { label: 'HTTPS', value: seoResult.results.technical.is_https ? 'Yes' : 'No', ok: seoResult.results.technical.is_https },
                      { label: 'Status code', value: seoResult.results.technical.status_code, ok: seoResult.results.technical.status_code < 400 },
                      { label: 'Response time', value: `${seoResult.results.technical.response_time_ms}ms`, ok: seoResult.results.technical.response_time_ms < 2000 },
                      { label: 'Page size', value: `${(seoResult.results.technical.page_size_bytes / 1024).toFixed(0)} KB` },
                      { label: 'robots.txt', value: seoResult.results.technical.has_robots_txt ? 'Found' : 'Missing', ok: seoResult.results.technical.has_robots_txt },
                      { label: 'sitemap.xml', value: seoResult.results.technical.has_sitemap ? 'Found' : 'Missing', ok: seoResult.results.technical.has_sitemap },
                      { label: 'Schema markup', value: seoResult.results.technical.has_schema_markup ? 'Detected' : 'None', ok: seoResult.results.technical.has_schema_markup },
                    ],
                  },
                  {
                    id: 'images', label: 'Images & Content',
                    rows: [
                      { label: 'Total images', value: seoResult.results.images.total },
                      { label: 'Missing alt text', value: seoResult.results.images.missing_alt, ok: seoResult.results.images.missing_alt === 0 },
                      { label: 'Alt coverage', value: `${seoResult.results.images.alt_coverage}%`, ok: seoResult.results.images.alt_coverage === 100 },
                      { label: 'Word count', value: seoResult.results.content.word_count, ok: seoResult.results.content.word_count >= 300 },
                      { label: 'Text/HTML ratio', value: `${seoResult.results.content.text_html_ratio}%` },
                    ],
                  },
                ].map(panel => (
                  <div key={panel.id} className="rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0d0f1a' }}>
                    <button
                      onClick={() => setExpandedSection(expandedSection === panel.id ? null : panel.id)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-white/3 transition-colors">
                      <h3 className="font-semibold text-sm">{panel.label}</h3>
                      <span className="text-zinc-500 text-lg">{expandedSection === panel.id ? '−' : '+'}</span>
                    </button>
                    {expandedSection === panel.id && (
                      <div className="px-6 pb-4 border-t border-white/5 pt-3">
                        {panel.rows.map(row => (
                          <StatRow key={row.label} label={row.label} value={row.value} ok={'ok' in row ? row.ok : undefined}/>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {/* Deep scan per-page breakdown */}
                {seoResult.pages && seoResult.pages.length > 1 && (
                  <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
                    <div className="px-6 py-4 border-b border-white/5">
                      <h3 className="font-semibold text-sm">Pages scanned ({seoResult.pages.length})</h3>
                    </div>
                    <div className="divide-y divide-white/5">
                      {seoResult.pages.map((p, i) => {
                        const c = p.score >= 80 ? '#22c55e' : p.score >= 60 ? '#f59e0b' : '#ef4444'
                        return (
                          <div key={i} className="flex items-center justify-between px-6 py-3">
                            <span className="text-sm text-zinc-300 truncate max-w-[70%]">{p.url}</span>
                            <span className="text-sm font-bold flex-shrink-0 ml-4" style={{ color: c }}>
                              {p.status === 'ok' ? `${p.score}/100` : p.status}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Scan history */}
            <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <h3 className="font-semibold text-sm">Recent scans</h3>
                {apiKey && (
                  <button onClick={() => loadHistory(apiKey)}
                    className="text-xs text-zinc-500 hover:text-white transition-colors">Refresh</button>
                )}
              </div>
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                </div>
              ) : seoHistory.length === 0 ? (
                <p className="text-sm text-zinc-600 text-center py-8">No scans yet — run your first scan above</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {seoHistory.map(s => {
                    const c = s.score >= 80 ? '#22c55e' : s.score >= 60 ? '#f59e0b' : '#ef4444'
                    return (
                      <div key={s.scan_id}
                        className="flex items-center justify-between px-6 py-3 hover:bg-white/3 cursor-pointer transition-colors"
                        onClick={async () => {
                          if (!apiKey) return
                          setSeoUrl(s.url)
                          setExpandedSection(null)
                          setSeoResult(null)
                          setSeoError('')
                          setScanning(true)
                          try {
                            const res = await fetch(`${API}/seo/scan/${s.scan_id}`, {
                              headers: { 'X-API-Key': apiKey },
                            })
                            if (res.ok) setSeoResult(await res.json())
                            else setSeoError('Could not load scan result')
                          } catch { setSeoError('Failed to load scan') }
                          setScanning(false)
                        }}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-200 truncate">{s.url}</p>
                          <p className="text-xs text-zinc-600 mt-0.5">
                            {new Date(s.created_at).toLocaleString()} · {s.pages_scanned}p
                          </p>
                        </div>
                        <span className="text-sm font-bold ml-4 flex-shrink-0" style={{ color: c }}>
                          {s.score}/100
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
