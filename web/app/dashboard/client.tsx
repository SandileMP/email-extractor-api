'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const EXAMPLE = (key: string) => `curl -X POST https://api.scrapify.io/emails \\
  -H "X-API-Key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://example.com"]}'`

interface Props {
  email: string
  subscriptionStatus: string
  apiKey: string | null
}

export default function DashboardClient({ email, subscriptionStatus, apiKey }: Props) {
  const router = useRouter()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)
  const [checkingOut, setCheckingOut] = useState(false)
  const isActive = subscriptionStatus === 'active'

  async function copyKey() {
    if (!apiKey) return
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/')
  }

  async function subscribe() {
    setCheckingOut(true)
    const res = await fetch('/api/checkout', { method: 'POST' })
    const { url, error } = await res.json()
    if (url) {
      window.location.href = url
    } else {
      alert(error ?? 'Could not start checkout')
      setCheckingOut(false)
    }
  }

  const maskedKey = apiKey ? `${apiKey.slice(0, 12)}${'•'.repeat(24)}` : null

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <nav className="border-b border-white/5 bg-zinc-950/80 backdrop-blur sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="font-bold text-lg text-brand">Scrapify</Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-zinc-500 hidden sm:block">{email}</span>
            <button onClick={logout} className="text-sm text-zinc-400 hover:text-white transition-colors">
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-2xl font-bold mb-8">Dashboard</h1>

        {/* Status card */}
        <div className="grid sm:grid-cols-2 gap-4 mb-8">
          <div className="p-6 bg-zinc-900 rounded-xl border border-white/5">
            <p className="text-sm text-zinc-400 mb-1">Subscription</p>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-brand' : 'bg-zinc-600'}`} />
              <span className="font-semibold capitalize">{isActive ? 'Active — R750/mo' : 'Inactive'}</span>
            </div>
          </div>
          <div className="p-6 bg-zinc-900 rounded-xl border border-white/5">
            <p className="text-sm text-zinc-400 mb-1">Plan</p>
            <span className="font-semibold">{isActive ? 'Scrapify Pro' : '—'}</span>
          </div>
        </div>

        {/* API key */}
        <div className="p-6 bg-zinc-900 rounded-xl border border-white/5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">API Key</h2>
            {apiKey && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowKey((v) => !v)}
                  className="text-xs px-3 py-1.5 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                >
                  {showKey ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={copyKey}
                  className="text-xs px-3 py-1.5 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          {apiKey ? (
            <div className="bg-zinc-800 rounded-lg px-4 py-3 font-mono text-sm text-zinc-300 break-all">
              {showKey ? apiKey : maskedKey}
            </div>
          ) : (
            <div className="bg-zinc-800/50 rounded-lg px-4 py-6 text-center">
              {isActive ? (
                <p className="text-sm text-zinc-400">Your API key is being provisioned…</p>
              ) : (
                <div>
                  <p className="text-sm text-zinc-400 mb-4">Subscribe to get your API key</p>
                  <button
                    onClick={subscribe}
                    disabled={checkingOut}
                    className="px-6 py-2.5 bg-brand text-black font-semibold rounded-lg hover:bg-green-400 disabled:opacity-50 transition-colors text-sm"
                  >
                    {checkingOut ? 'Redirecting…' : 'Subscribe — R750/month →'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick start */}
        {apiKey && (
          <div className="p-6 bg-zinc-900 rounded-xl border border-white/5 mb-8">
            <h2 className="font-semibold mb-4">Quick start</h2>
            <pre className="bg-zinc-800 rounded-lg p-4 text-xs font-mono text-green-400 overflow-x-auto whitespace-pre-wrap">
              {EXAMPLE(showKey ? apiKey : 'sc_live_your_key')}
            </pre>
          </div>
        )}

        {/* Docs link */}
        <div className="p-6 bg-zinc-900 rounded-xl border border-white/5 flex items-center justify-between">
          <div>
            <h2 className="font-semibold mb-1">API Documentation</h2>
            <p className="text-sm text-zinc-400">Interactive Swagger UI with all endpoints</p>
          </div>
          <a
            href="https://ebfczvv0p2.execute-api.eu-west-1.amazonaws.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 border border-white/10 rounded-lg text-sm hover:bg-white/5 transition-colors whitespace-nowrap"
          >
            View docs ↗
          </a>
        </div>
      </main>
    </div>
  )
}
