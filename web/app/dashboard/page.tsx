'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'
import type { User } from '@supabase/supabase-js'

const API_BASE = 'https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com'
const CHECKOUT_URL = process.env.NEXT_PUBLIC_CHECKOUT_URL!
const CANCEL_URL   = `${API_BASE}/cancel`

const EXAMPLE = (key: string) =>
  `curl -X POST ${API_BASE}/emails \\
  -H "X-API-Key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'`

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
      // Use limit(1) + index 0 instead of maybeSingle() so multiple rows never cause null
      const [{ data: keys }, { data: subs }] = await Promise.all([
        supabase.from('api_keys').select('api_key').eq('user_id', session.user.id).eq('active', true).order('created_at', { ascending: false }).limit(1),
        supabase.from('subscriptions').select('status').eq('user_id', session.user.id).order('updated_at', { ascending: false }).limit(1),
      ])
      const keyRow = keys?.[0]
      const sub    = subs?.[0]
      setApiKey(keyRow?.api_key ?? null)
      setSubStatus(sub?.status ?? 'inactive')
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
    } catch { showToast('Could not reach checkout service', 'error'); setCheckingOut(false) }
  }

  async function cancelSubscription() {
    if (!user) return
    if (!confirm('Cancel your subscription? Your API key will be deactivated immediately.')) return
    setCancelling(true)
    try {
      const res = await fetch(CANCEL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id }),
      })
      const data = await res.json()
      if (data.cancelled) {
        setSubStatus('inactive')
        setApiKey(null)
        showToast('Subscription cancelled successfully')
      } else {
        showToast(data.error ?? 'Could not cancel subscription', 'error')
      }
    } catch { showToast('Could not reach cancellation service', 'error') }
    setCancelling(false)
  }

  async function copyKey() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function logout() {
    await createClient().auth.signOut()
    router.push('/')
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
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-2xl border transition-all ${
          toast.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-red-500/10 border-red-500/30 text-red-300'
        }`}>
          {toast.type === 'success' ? '✓ ' : '✕ '}{toast.msg}
        </div>
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

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
            isActive
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-zinc-800 border-zinc-700 text-zinc-500'
          }`}>
            {isActive ? '● Active' : '○ Inactive'}
          </span>
        </div>

        {/* Status row */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Plan', value: isActive ? 'MeshParse Pro' : 'No plan' },
            { label: 'Billing', value: isActive ? 'R750 / month' : '—' },
            { label: 'Status', value: isActive ? 'Active' : 'Inactive' },
          ].map(c => (
            <div key={c.label} className="p-5 rounded-xl border border-white/5" style={{ background: '#0d0f1a' }}>
              <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">{c.label}</p>
              <p className="font-semibold text-white">{c.value}</p>
            </div>
          ))}
        </div>

        {/* API Key card */}
        <div className="rounded-xl border border-white/5 mb-6" style={{ background: '#0d0f1a' }}>
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
                {isActive ? (
                  <p className="text-sm text-zinc-400">Your API key is being provisioned…</p>
                ) : (
                  <div>
                    <p className="text-sm text-zinc-400 mb-4">Subscribe to unlock your API key</p>
                    <button onClick={subscribe} disabled={checkingOut}
                      className="px-6 py-2.5 font-bold text-black rounded-xl text-sm disabled:opacity-50 transition-all hover:opacity-90"
                      style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
                      {checkingOut ? 'Redirecting…' : 'Subscribe — R10/month (test) →'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick start */}
        {apiKey && (
          <div className="rounded-xl border border-white/5 mb-6" style={{ background: '#0d0f1a' }}>
            <div className="px-6 py-4 border-b border-white/5">
              <h2 className="font-semibold">Quick start</h2>
            </div>
            <div className="p-6">
              <pre className="text-[13px] font-mono text-emerald-400 overflow-x-auto leading-relaxed">
                {EXAMPLE(showKey && apiKey ? apiKey : 'mp_live_your_key')}
              </pre>
            </div>
          </div>
        )}

        {/* Links row */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <a href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-between p-5 rounded-xl border border-white/5 hover:border-white/10 transition-colors group"
            style={{ background: '#0d0f1a' }}>
            <div>
              <p className="font-semibold text-sm mb-0.5">API Documentation</p>
              <p className="text-xs text-zinc-500">Swagger UI with all endpoints</p>
            </div>
            <span className="text-zinc-500 group-hover:text-white transition-colors">↗</span>
          </a>
          <div className="flex items-center justify-between p-5 rounded-xl border border-white/5"
            style={{ background: '#0d0f1a' }}>
            <div>
              <p className="font-semibold text-sm mb-0.5">Support</p>
              <p className="text-xs text-zinc-500">Get help with your integration</p>
            </div>
            <span className="text-xs text-zinc-600">Coming soon</span>
          </div>
        </div>

        {/* Danger zone — cancel */}
        {isActive && (
          <div className="rounded-xl border border-red-500/10 p-6" style={{ background: '#0d0f1a' }}>
            <h3 className="font-semibold text-sm mb-1 text-red-400">Danger zone</h3>
            <p className="text-xs text-zinc-500 mb-4">
              Cancelling will immediately deactivate your API key. You can resubscribe at any time.
            </p>
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
