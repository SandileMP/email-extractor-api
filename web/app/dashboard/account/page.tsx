'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import type { User } from '@supabase/supabase-js'

const API          = 'https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com'
const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL!

export default function AccountPage() {
  const router = useRouter()
  const [user, setUser]           = useState<User | null>(null)
  const [apiKey, setApiKey]       = useState<string | null>(null)
  const [subStatus, setSubStatus] = useState('inactive')
  const [showKey, setShowKey]     = useState(false)
  const [copied, setCopied]       = useState(false)
  const [loading, setLoading]     = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [cancelling, setCancelling]   = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

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
      setApiKey(keys?.[0]?.api_key ?? null)
      setSubStatus(subs?.[0]?.status ?? 'inactive')
      setLoading(false)
    }
    load()
    const { data: { subscription } } = supabase.auth.onAuthStateChange(e => {
      if (e === 'SIGNED_OUT') router.push('/')
    })
    return () => subscription.unsubscribe()
  }, [router])

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

  async function copyKey() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  async function logout() {
    await createClient().auth.signOut(); router.push('/')
  }

  const isActive  = subStatus === 'active'
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
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-zinc-500 hover:text-white transition-colors text-sm">← Dashboard</Link>
            <span className="text-zinc-700">|</span>
            <Link href="/" className="flex items-center gap-2">
              <img src="/icon.svg" alt="Weblandr" className="w-6 h-6" />
              <span className="font-bold text-sm">Weblandr</span>
            </Link>
          </div>
          <button onClick={logout} className="text-sm text-zinc-400 hover:text-white transition-colors">Sign out</button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Account</h1>
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
            isActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                     : 'bg-zinc-800 border-zinc-700 text-zinc-500'
          }`}>{isActive ? '● Active' : '○ Inactive'}</span>
        </div>

        {/* Profile */}
        <div className="rounded-xl border border-white/5 p-6" style={{ background: '#0d0f1a' }}>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Profile</h2>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold"
              style={{ background: 'linear-gradient(135deg,#22c55e30,#06b6d430)', border: '1px solid #22c55e20' }}>
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-zinc-200">{user?.email}</p>
              <p className="text-xs text-zinc-500 mt-0.5">Member since {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' }) : '—'}</p>
            </div>
          </div>
        </div>

        {/* Subscription */}
        <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
          <div className="px-6 py-4 border-b border-white/5">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Subscription</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Plan',    value: isActive ? 'Weblandr Pro' : 'No plan' },
                { label: 'Billing', value: isActive ? 'R999 / month'  : '—' },
                { label: 'Status',  value: isActive ? 'Active'        : 'Inactive' },
              ].map(c => (
                <div key={c.label}>
                  <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">{c.label}</p>
                  <p className="text-sm font-semibold text-zinc-200">{c.value}</p>
                </div>
              ))}
            </div>
            {!isActive && (
              <button onClick={subscribe} disabled={checkingOut}
                className="px-6 py-2.5 font-bold text-black rounded-xl text-sm disabled:opacity-50"
                style={{ background: 'linear-gradient(90deg,#22c55e,#16a34a)' }}>
                {checkingOut ? 'Redirecting…' : 'Subscribe — R999/month →'}
              </button>
            )}
          </div>
        </div>

        {/* API Key */}
        <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">API Key</h2>
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
              <>
                <div className="font-mono text-sm text-emerald-400 bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-4 py-3 break-all mb-3">
                  {showKey ? apiKey : maskedKey}
                </div>
                <p className="text-xs text-zinc-600">Include this key as <code className="text-zinc-400">X-API-Key</code> in every API request.</p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">
                {isActive ? 'Your API key is being provisioned…' : 'Subscribe to get your API key.'}
              </p>
            )}
          </div>
        </div>

        {/* Quick start */}
        {apiKey && (
          <div className="rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Quick start</h2>
              <span className="text-xs text-zinc-600">Email extraction</span>
            </div>
            <pre className="p-6 text-[13px] font-mono text-emerald-400 overflow-x-auto leading-relaxed">{`curl -X POST ${API}/emails \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'mp_live_your_key'}" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'`}</pre>
          </div>
        )}

        {/* Links */}
        <div className="grid grid-cols-2 gap-4">
          <a href={`${API}/docs`} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between p-5 rounded-xl border border-white/5 hover:border-white/10 transition-colors group"
            style={{ background: '#0d0f1a' }}>
            <div>
              <p className="font-semibold text-sm mb-0.5">API Documentation</p>
              <p className="text-xs text-zinc-500">Swagger UI for all endpoints</p>
            </div>
            <span className="text-zinc-500 group-hover:text-white transition-colors">↗</span>
          </a>
          <Link href="/dashboard"
            className="flex items-center justify-between p-5 rounded-xl border border-white/5 hover:border-white/10 transition-colors group"
            style={{ background: '#0d0f1a' }}>
            <div>
              <p className="font-semibold text-sm mb-0.5">Dashboard</p>
              <p className="text-xs text-zinc-500">Back to your tools</p>
            </div>
            <span className="text-zinc-500 group-hover:text-white transition-colors">→</span>
          </Link>
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
      </main>
    </div>
  )
}
