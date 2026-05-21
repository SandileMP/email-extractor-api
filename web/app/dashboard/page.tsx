'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import type { User } from '@supabase/supabase-js'

const API = 'https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com'
const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL!

// ── Types ─────────────────────────────────────────────────────────────────

interface MailAccount {
  account_id: string; user_id: string; label: string; host: string; port: number
  username: string; from_email: string; from_name: string; use_tls: boolean; created_at: string
}

interface Campaign {
  campaign_id: string; name: string; status: string; subject: string
  html_body: string; text_body?: string; mail_account_id: string
  recipient_count: number; sent_count: number; bounced_count: number; failed_count: number
  from_email: string; created_at: string; sent_at: string | null
}

interface CampaignLog {
  log_id: string; recipient: string; status: string; sent_at: string; error?: string
}

interface Extraction {
  extraction_id: string; urls: string[]; email_count: number; created_at: string
}

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

  // Campaigns state
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [extractions, setExtractions] = useState<Extraction[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [campaignLogs, setCampaignLogs] = useState<CampaignLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Mail account form
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [acctLabel, setAcctLabel] = useState('')
  const [acctHost, setAcctHost] = useState('')
  const [acctPort, setAcctPort] = useState('587')
  const [acctUsername, setAcctUsername] = useState('')
  const [acctPassword, setAcctPassword] = useState('')
  const [acctFromEmail, setAcctFromEmail] = useState('')
  const [acctFromName, setAcctFromName] = useState('')
  const [acctTls, setAcctTls] = useState(true)
  const [savingAccount, setSavingAccount] = useState(false)

  // Campaign builder / editor
  const [showCampaignForm, setShowCampaignForm] = useState(false)
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [campName, setCampName] = useState('')
  const [campAccount, setCampAccount] = useState('')
  const [campSubject, setCampSubject] = useState('')
  const [campHtml, setCampHtml] = useState('')
  const [campText, setCampText] = useState('')
  const [campRecipientMode, setCampRecipientMode] = useState<'paste' | 'csv' | 'json' | 'extraction'>('paste')
  const [campEmailsPasted, setCampEmailsPasted] = useState('')
  const [campExtractionId, setCampExtractionId] = useState('')
  const [showVarHints, setShowVarHints] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [creatingCampaign, setCreatingCampaign] = useState(false)
  const [sendingCampaign, setSendingCampaign] = useState<string | null>(null)

  // SEO scanner state
  const [tab, setTab] = useState<'overview' | 'seo' | 'campaigns'>('overview')
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

  const loadCampaignsData = useCallback(async (key: string) => {
    setCampaignsLoading(true)
    try {
      const [acctRes, campRes, extRes] = await Promise.all([
        fetch(`${API}/mail-accounts`, { headers: { 'X-API-Key': key } }),
        fetch(`${API}/campaigns`, { headers: { 'X-API-Key': key } }),
        fetch(`${API}/extractions`, { headers: { 'X-API-Key': key } }),
      ])
      if (acctRes.ok) setMailAccounts((await acctRes.json()).accounts || [])
      if (campRes.ok) setCampaigns((await campRes.json()).campaigns || [])
      if (extRes.ok) setExtractions((await extRes.json()).extractions || [])
    } catch { /* silent */ }
    setCampaignsLoading(false)
  }, [])

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
            { id: 'seo', label: 'SEO Scanner' },
            { id: 'campaigns', label: 'Campaigns' },
          ].map(t => (
            <button key={t.id} onClick={() => {
              setTab(t.id as typeof tab)
              if (t.id === 'campaigns' && apiKey) loadCampaignsData(apiKey)
            }}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                tab === t.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}>
              {t.label}
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
                { label: 'Billing', value: isActive ? 'R999 / month' : '—' },
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
                            {checkingOut ? 'Redirecting…' : 'Subscribe — R999/month →'}
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
            <div className="grid sm:grid-cols-3 gap-4">
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
                  <p className="font-semibold text-sm mb-0.5 text-emerald-400">SEO Scanner</p>
                  <p className="text-xs text-zinc-500">Audit any website for SEO issues</p>
                </div>
                <span className="text-emerald-500 group-hover:text-emerald-400 transition-colors">→</span>
              </button>
              <button onClick={() => { setTab('campaigns'); if (apiKey) loadCampaignsData(apiKey) }}
                className="flex items-center justify-between p-5 rounded-xl border border-cyan-500/20 hover:border-cyan-500/30 transition-colors text-left group"
                style={{ background: 'linear-gradient(135deg,#0a1a1e,#0a0f1e)' }}>
                <div>
                  <p className="font-semibold text-sm mb-0.5 text-cyan-400">Email Campaigns</p>
                  <p className="text-xs text-zinc-500">Send campaigns via your SMTP</p>
                </div>
                <span className="text-cyan-500 group-hover:text-cyan-400 transition-colors">→</span>
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

        {/* ── CAMPAIGNS TAB ───────────────────────────────────────────── */}
        {tab === 'campaigns' && (
          <div className="space-y-6">
            {!isActive && (
              <div className="rounded-xl border border-emerald-500/20 p-6 flex items-center gap-4"
                style={{ background: 'linear-gradient(135deg,#0d1a12,#0a0f1e)' }}>
                <span className="text-3xl">📧</span>
                <div className="flex-1">
                  <p className="font-semibold mb-1">Email Campaigns requires an active subscription</p>
                  <p className="text-sm text-zinc-400">Subscribe to send campaigns using your own SMTP credentials.</p>
                </div>
                <button onClick={subscribe} disabled={checkingOut}
                  className="flex-shrink-0 px-5 py-2 font-bold text-black rounded-lg text-sm"
                  style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)' }}>
                  Subscribe →
                </button>
              </div>
            )}

            {/* ── Mail accounts ── */}
            <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <div>
                  <h2 className="font-semibold">Mail Accounts</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Your SMTP credentials — used to send campaigns</p>
                </div>
                {isActive && (
                  <button onClick={() => setShowAccountForm(v => !v)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-zinc-300">
                    {showAccountForm ? 'Cancel' : '+ Add account'}
                  </button>
                )}
              </div>

              {showAccountForm && (
                <div className="p-6 border-b border-white/5 space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    {[
                      { label: 'Label', value: acctLabel, set: setAcctLabel, placeholder: 'e.g. Work Gmail' },
                      { label: 'From name', value: acctFromName, set: setAcctFromName, placeholder: 'Your Name' },
                      { label: 'From email', value: acctFromEmail, set: setAcctFromEmail, placeholder: 'you@example.com' },
                      { label: 'Username', value: acctUsername, set: setAcctUsername, placeholder: 'SMTP username' },
                    ].map(f => (
                      <div key={f.label}>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">{f.label}</label>
                        <input value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
                          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                          style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                      </div>
                    ))}
                  </div>
                  <div className="grid sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">SMTP host</label>
                      <input value={acctHost} onChange={e => setAcctHost(e.target.value)} placeholder="smtp.gmail.com"
                        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                        style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Port</label>
                      <input value={acctPort} onChange={e => setAcctPort(e.target.value)} placeholder="587"
                        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                        style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Password</label>
                      <input type="password" value={acctPassword} onChange={e => setAcctPassword(e.target.value)} placeholder="App password"
                        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                        style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div className={`w-9 h-5 rounded-full relative transition-colors ${acctTls ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                        onClick={() => setAcctTls(v => !v)}>
                        <div className={`w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform ${acctTls ? 'translate-x-4' : 'translate-x-0.5'}`}/>
                      </div>
                      <span className="text-sm text-zinc-400">STARTTLS (port 587) — disable for SSL port 465</span>
                    </label>
                  </div>
                  <button
                    disabled={savingAccount || !acctLabel || !acctHost || !acctUsername || !acctPassword || !acctFromEmail}
                    onClick={async () => {
                      if (!apiKey) return
                      setSavingAccount(true)
                      try {
                        const res = await fetch(`${API}/mail-accounts`, {
                          method: 'POST',
                          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            label: acctLabel, host: acctHost, port: parseInt(acctPort),
                            username: acctUsername, password: acctPassword,
                            from_email: acctFromEmail, from_name: acctFromName, use_tls: acctTls,
                          }),
                        })
                        const data = await res.json()
                        if (data.error) { showToast(data.error, 'error') }
                        else {
                          showToast('Mail account added')
                          setShowAccountForm(false)
                          setAcctLabel(''); setAcctHost(''); setAcctPort('587')
                          setAcctUsername(''); setAcctPassword(''); setAcctFromEmail(''); setAcctFromName('')
                          loadCampaignsData(apiKey)
                        }
                      } catch { showToast('Could not save account', 'error') }
                      setSavingAccount(false)
                    }}
                    className="px-5 py-2.5 font-bold text-sm rounded-lg disabled:opacity-40 transition-all"
                    style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)', color: '#000' }}>
                    {savingAccount ? 'Testing & saving…' : 'Save account'}
                  </button>
                </div>
              )}

              {campaignsLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                </div>
              ) : mailAccounts.length === 0 ? (
                <p className="text-sm text-zinc-600 text-center py-8">No mail accounts yet — add one to start sending</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {mailAccounts.map(a => (
                    <div key={a.account_id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <p className="text-sm font-semibold text-zinc-200">{a.label}</p>
                        <p className="text-xs text-zinc-500">{a.from_email} via {a.host}:{a.port}</p>
                      </div>
                      <button
                        onClick={async () => {
                          if (!apiKey || !confirm(`Delete "${a.label}"?`)) return
                          await fetch(`${API}/mail-accounts/${a.account_id}`, {
                            method: 'DELETE', headers: { 'X-API-Key': apiKey },
                          })
                          loadCampaignsData(apiKey)
                        }}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded border border-red-500/20 hover:bg-red-500/10">
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Campaign list ── */}
            <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                <div>
                  <h2 className="font-semibold">Campaigns</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Create and send email campaigns to your recipients</p>
                </div>
                {isActive && (
                  <button
                    onClick={() => {
                      if (mailAccounts.length === 0) { showToast('Add a mail account first', 'error'); setShowAccountForm(true); return }
                      if (showCampaignForm) {
                        setShowCampaignForm(false); setEditingCampaignId(null)
                        setCampName(''); setCampAccount(''); setCampSubject(''); setCampHtml(''); setCampText(''); setCampEmailsPasted('')
                      } else {
                        setEditingCampaignId(null); setShowCampaignForm(true); setSelectedCampaign(null)
                      }
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-zinc-300">
                    {showCampaignForm ? 'Cancel' : '+ New campaign'}
                  </button>
                )}
              </div>

              {/* Campaign builder / editor */}
              {showCampaignForm && (
                <div className="p-6 border-b border-white/5 space-y-5">
                  <h3 className="text-sm font-bold text-zinc-300">{editingCampaignId ? 'Edit campaign' : 'New campaign'}</h3>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Campaign name</label>
                      <input value={campName} onChange={e => setCampName(e.target.value)} placeholder="e.g. May Outreach"
                        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                        style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Mail account</label>
                      <select value={campAccount} onChange={e => setCampAccount(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                        style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}>
                        <option value="">— select account —</option>
                        {mailAccounts.map(a => (
                          <option key={a.account_id} value={a.account_id}>{a.label} ({a.from_email})</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Subject line</label>
                    <input value={campSubject} onChange={e => setCampSubject(e.target.value)}
                      placeholder="Hi {{first_name}}, we have something for you…"
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                      style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                  </div>

                  {/* HTML body + variable hint toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">HTML body</label>
                      <div className="flex gap-2">
                        <button onClick={() => setShowVarHints(v => !v)}
                          className="text-[10px] px-2 py-1 rounded border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 transition-colors">
                          {showVarHints ? 'Hide' : '{ } Variables'}
                        </button>
                        <button onClick={() => setShowPreview(v => !v)}
                          className="text-[10px] px-2 py-1 rounded border border-white/10 text-zinc-400 hover:bg-white/5 transition-colors">
                          {showPreview ? 'Hide preview' : 'Preview'}
                        </button>
                      </div>
                    </div>

                    {showVarHints && (
                      <div className="mb-3 p-4 rounded-lg border border-cyan-500/20 text-xs space-y-2"
                        style={{ background: 'rgba(6,182,212,0.04)' }}>
                        <p className="font-semibold text-cyan-400 mb-2">Template variables — use in subject or HTML body</p>
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                          {[
                            ['{{email}}', 'Recipient email address'],
                            ['{{first_name}}', 'First name (from CSV/JSON)'],
                            ['{{last_name}}', 'Last name (from CSV/JSON)'],
                            ['{{company}}', 'Company name (from CSV/JSON)'],
                            ['{{unsubscribe_link}}', 'One-click unsubscribe URL'],
                          ].map(([v, desc]) => (
                            <div key={v} className="flex items-baseline gap-2">
                              <code className="text-cyan-300 font-mono flex-shrink-0">{v}</code>
                              <span className="text-zinc-500">{desc}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-zinc-600 mt-2">Any column in your CSV becomes a variable. Unknown variables are left as-is.</p>
                        <p className="text-zinc-500 font-semibold mt-1">CSV example:</p>
                        <pre className="text-zinc-400 font-mono text-[11px] bg-black/20 rounded p-2">email,first_name,company{'\n'}jane@acme.com,Jane,Acme Corp{'\n'}bob@corp.com,Bob,Corp Inc</pre>
                      </div>
                    )}

                    <textarea value={campHtml} onChange={e => setCampHtml(e.target.value)} rows={8}
                      placeholder={"<h1>Hello {{first_name}}!</h1>\n<p>We're reaching out to {{company}}…</p>"}
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono resize-y"
                      style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>

                    {showPreview && campHtml && (
                      <div className="mt-3 rounded-lg border border-white/10 overflow-hidden">
                        <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-zinc-500 uppercase tracking-wider">
                          Preview (sample data: first_name=Alex, company=Acme)
                        </div>
                        <div className="bg-white p-4 text-black text-sm max-h-72 overflow-y-auto"
                          dangerouslySetInnerHTML={{ __html:
                            campHtml
                              .replace(/\{\{first_name\}\}/g, 'Alex')
                              .replace(/\{\{last_name\}\}/g, 'Smith')
                              .replace(/\{\{company\}\}/g, 'Acme')
                              .replace(/\{\{email\}\}/g, 'alex@acme.com')
                              .replace(/\{\{unsubscribe_link\}\}/g, '#')
                          }}/>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Plain text (optional)</label>
                    <textarea value={campText} onChange={e => setCampText(e.target.value)} rows={3}
                      placeholder="Plain text fallback — auto-stripped from HTML if empty"
                      className="w-full px-3 py-2.5 rounded-lg text-sm outline-none resize-y"
                      style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                  </div>

                  {/* Recipient picker */}
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Recipients</label>
                    <div className="flex gap-1 p-1 rounded-lg w-fit mb-3" style={{ background: '#0a0c14', border: '1px solid #ffffff10' }}>
                      {[
                        { id: 'paste', label: 'Emails' },
                        { id: 'csv', label: 'CSV' },
                        { id: 'json', label: 'JSON' },
                        { id: 'extraction', label: 'Extraction' },
                      ].map(m => (
                        <button key={m.id} onClick={() => setCampRecipientMode(m.id as typeof campRecipientMode)}
                          className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                            campRecipientMode === m.id ? 'bg-white/10 text-white' : 'text-zinc-500 hover:text-zinc-300'
                          }`}>{m.label}</button>
                      ))}
                    </div>

                    {campRecipientMode === 'paste' && (
                      <div>
                        <p className="text-xs text-zinc-600 mb-2">One email per line, or comma/semicolon separated. No variable support — use CSV for that.</p>
                        <textarea value={campEmailsPasted} onChange={e => setCampEmailsPasted(e.target.value)} rows={4}
                          placeholder={"one@example.com\ntwo@example.com\nthree@example.com"}
                          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono resize-y"
                          style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                      </div>
                    )}

                    {campRecipientMode === 'csv' && (
                      <div>
                        <p className="text-xs text-zinc-600 mb-2">Header row required. Must include an <code className="text-cyan-400">email</code> column. Extra columns become template variables.</p>
                        <textarea value={campEmailsPasted} onChange={e => setCampEmailsPasted(e.target.value)} rows={6}
                          placeholder={"email,first_name,company\njane@acme.com,Jane,Acme Corp\nbob@corp.com,Bob,Corp Inc"}
                          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono resize-y"
                          style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                      </div>
                    )}

                    {campRecipientMode === 'json' && (
                      <div>
                        <p className="text-xs text-zinc-600 mb-2">Array of objects. Each must have an <code className="text-cyan-400">email</code> field. Extra fields become template variables.</p>
                        <textarea value={campEmailsPasted} onChange={e => setCampEmailsPasted(e.target.value)} rows={6}
                          placeholder={'[\n  {"email": "jane@acme.com", "first_name": "Jane", "company": "Acme"},\n  {"email": "bob@corp.com", "first_name": "Bob"}\n]'}
                          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none font-mono resize-y"
                          style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}/>
                      </div>
                    )}

                    {campRecipientMode === 'extraction' && (
                      extractions.length === 0 ? (
                        <p className="text-sm text-zinc-600 py-4">No extractions yet — run email extraction first.</p>
                      ) : (
                        <select value={campExtractionId} onChange={e => setCampExtractionId(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                          style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}>
                          <option value="">— select extraction —</option>
                          {extractions.map(ex => (
                            <option key={ex.extraction_id} value={ex.extraction_id}>
                              {ex.email_count} emails · {ex.urls.slice(0,2).join(', ')}{ex.urls.length > 2 ? ` +${ex.urls.length - 2}` : ''} · {new Date(ex.created_at).toLocaleDateString()}
                            </option>
                          ))}
                        </select>
                      )
                    )}
                  </div>

                  <button
                    disabled={creatingCampaign || !campName || !campAccount || !campSubject || !campHtml ||
                      (!editingCampaignId && campRecipientMode === 'paste' && !campEmailsPasted.trim()) ||
                      (!editingCampaignId && campRecipientMode === 'csv'   && !campEmailsPasted.trim()) ||
                      (!editingCampaignId && campRecipientMode === 'json'  && !campEmailsPasted.trim()) ||
                      (!editingCampaignId && campRecipientMode === 'extraction' && !campExtractionId)}
                    onClick={async () => {
                      if (!apiKey) return
                      setCreatingCampaign(true)

                      const recipientPayload: Record<string, unknown> = {}
                      if (campRecipientMode === 'paste') {
                        recipientPayload.recipients = campEmailsPasted.split(/[\n,;]+/).map(e => e.trim()).filter(Boolean)
                      } else if (campRecipientMode === 'csv') {
                        recipientPayload.recipients_csv = campEmailsPasted
                      } else if (campRecipientMode === 'json') {
                        recipientPayload.recipients_json = campEmailsPasted
                      } else if (campRecipientMode === 'extraction') {
                        recipientPayload.extraction_id = campExtractionId
                      }

                      try {
                        const isEdit = !!editingCampaignId
                        const url    = isEdit ? `${API}/campaigns/${editingCampaignId}` : `${API}/campaigns`
                        const method = isEdit ? 'PATCH' : 'POST'

                        const body: Record<string, unknown> = {
                          name: campName, mail_account_id: campAccount,
                          subject: campSubject, html_body: campHtml,
                          text_body: campText || undefined,
                          ...recipientPayload,
                        }

                        const res = await fetch(url, {
                          method,
                          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
                          body: JSON.stringify(body),
                        })
                        const data = await res.json()
                        if (data.error) { showToast(data.error, 'error') }
                        else {
                          showToast(isEdit ? 'Campaign updated' : `Campaign "${campName}" created`)
                          setShowCampaignForm(false); setEditingCampaignId(null)
                          setCampName(''); setCampAccount(''); setCampSubject(''); setCampHtml(''); setCampText('')
                          setCampEmailsPasted(''); setCampExtractionId('')
                          loadCampaignsData(apiKey)
                        }
                      } catch { showToast('Could not save campaign', 'error') }
                      setCreatingCampaign(false)
                    }}
                    className="px-5 py-2.5 font-bold text-sm rounded-lg disabled:opacity-40 transition-all"
                    style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)', color: '#000' }}>
                    {creatingCampaign
                      ? (editingCampaignId ? 'Saving…' : 'Creating…')
                      : (editingCampaignId ? 'Save changes' : 'Create campaign')}
                  </button>
                </div>
              )}

              {/* Campaign list */}
              {!showCampaignForm && (
                campaignsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                  </div>
                ) : campaigns.length === 0 ? (
                  <p className="text-sm text-zinc-600 text-center py-8">No campaigns yet — create your first campaign above</p>
                ) : (
                  <div className="divide-y divide-white/5">
                    {campaigns.map(c => {
                      const statusColor: Record<string,string> = {
                        draft: 'text-zinc-400', queued: 'text-blue-400',
                        sending: 'text-yellow-400', sent: 'text-emerald-400', failed: 'text-red-400',
                      }
                      return (
                        <div key={c.campaign_id}
                          className="px-6 py-4 hover:bg-white/3 cursor-pointer transition-colors"
                          onClick={async () => {
                            if (selectedCampaign?.campaign_id === c.campaign_id) {
                              setSelectedCampaign(null); setCampaignLogs([]); return
                            }
                            setSelectedCampaign(c)
                            if (!apiKey) return
                            setLogsLoading(true)
                            try {
                              const res = await fetch(`${API}/campaigns/${c.campaign_id}/logs`, {
                                headers: { 'X-API-Key': apiKey },
                              })
                              if (res.ok) setCampaignLogs((await res.json()).logs || [])
                            } catch { /* silent */ }
                            setLogsLoading(false)
                          }}>
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold text-sm text-zinc-200">{c.name}</span>
                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                  c.status === 'draft' ? 'border-zinc-600 text-zinc-400' :
                                  c.status === 'queued' ? 'border-blue-500/30 text-blue-400 bg-blue-500/10' :
                                  c.status === 'sending' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' :
                                  c.status === 'sent' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                                  'border-red-500/30 text-red-400 bg-red-500/10'
                                }`}>{c.status}</span>
                              </div>
                              <p className="text-xs text-zinc-500 truncate">{c.subject}</p>
                              <div className="flex gap-3 mt-1.5 text-xs text-zinc-600">
                                <span>{c.recipient_count} recipients</span>
                                {c.sent_count > 0 && <span className="text-emerald-600">{c.sent_count} sent</span>}
                                {c.bounced_count > 0 && <span className="text-red-600">{c.bounced_count} bounced</span>}
                                {c.failed_count > 0 && <span className="text-red-600">{c.failed_count} failed</span>}
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-2 flex-shrink-0">
                              <span className="text-xs text-zinc-600">{new Date(c.created_at).toLocaleDateString()}</span>
                              {c.status === 'draft' && (
                                <div className="flex gap-2">
                                  <button
                                    onClick={e => {
                                      e.stopPropagation()
                                      setEditingCampaignId(c.campaign_id)
                                      setCampName(c.name)
                                      setCampAccount(c.mail_account_id)
                                      setCampSubject(c.subject)
                                      setCampHtml(c.html_body)
                                      setCampText(c.text_body || '')
                                      setCampEmailsPasted('')
                                      setCampExtractionId('')
                                      setCampRecipientMode('paste')
                                      setShowCampaignForm(true)
                                      setSelectedCampaign(null)
                                      window.scrollTo({ top: 0, behavior: 'smooth' })
                                    }}
                                    className="text-xs px-3 py-1 rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-zinc-400">
                                    Edit
                                  </button>
                                  <button
                                    disabled={sendingCampaign === c.campaign_id}
                                    onClick={async e => {
                                      e.stopPropagation()
                                      if (!apiKey) return
                                      setSendingCampaign(c.campaign_id)
                                      try {
                                        const res = await fetch(`${API}/campaigns/${c.campaign_id}/send`, {
                                          method: 'POST', headers: { 'X-API-Key': apiKey },
                                        })
                                        const data = await res.json()
                                        if (data.error) showToast(data.error, 'error')
                                        else { showToast(`Campaign queued — ${data.queued} recipients`); loadCampaignsData(apiKey) }
                                      } catch { showToast('Could not send campaign', 'error') }
                                      setSendingCampaign(null)
                                    }}
                                    className="text-xs px-3 py-1 rounded-lg font-bold disabled:opacity-50"
                                    style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)', color: '#000' }}>
                                    {sendingCampaign === c.campaign_id ? 'Queuing…' : 'Send →'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Inline logs panel */}
                          {selectedCampaign?.campaign_id === c.campaign_id && (
                            <div className="mt-4 rounded-xl border border-white/5 overflow-hidden" style={{ background: '#0a0c14' }}
                              onClick={e => e.stopPropagation()}>
                              <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Delivery log</span>
                                <button onClick={async () => {
                                  if (!apiKey) return
                                  setLogsLoading(true)
                                  const res = await fetch(`${API}/campaigns/${c.campaign_id}/logs`, { headers: { 'X-API-Key': apiKey } })
                                  if (res.ok) setCampaignLogs((await res.json()).logs || [])
                                  setLogsLoading(false)
                                }} className="text-xs text-zinc-600 hover:text-white transition-colors">Refresh</button>
                              </div>
                              {logsLoading ? (
                                <div className="flex justify-center py-6">
                                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                                </div>
                              ) : campaignLogs.length === 0 ? (
                                <p className="text-xs text-zinc-600 text-center py-6">No delivery logs yet</p>
                              ) : (
                                <div className="max-h-60 overflow-y-auto divide-y divide-white/5">
                                  {campaignLogs.map(l => (
                                    <div key={l.log_id} className="flex items-center justify-between px-4 py-2">
                                      <span className="text-xs text-zinc-300 font-mono truncate max-w-[60%]">{l.recipient}</span>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {l.error && <span className="text-[10px] text-zinc-600 truncate max-w-[120px]">{l.error}</span>}
                                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                                          l.status === 'sent' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' :
                                          l.status === 'bounced' ? 'border-red-500/30 text-red-400 bg-red-500/10' :
                                          l.status === 'suppressed' ? 'border-zinc-600 text-zinc-500' :
                                          'border-red-500/30 text-red-400 bg-red-500/10'
                                        }`}>{l.status}</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              )}
            </div>
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
