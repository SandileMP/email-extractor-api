'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function SignUp() {
  const router = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [confirmed, setConfirmed] = useState(false)   // show post-signup screen

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { data, error: err } = await supabase.auth.signUp({ email, password })
    setLoading(false)
    if (err) { setError(err.message); return }

    // If email confirmation is required, Supabase returns a session=null
    // and sends a confirmation email. Show the check-your-email screen.
    if (!data.session) {
      setConfirmed(true)
      return
    }

    // If auto-confirm is on (dev/test), session is available immediately
    router.push('/dashboard/account?welcome=1')
  }

  const glow = (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
      <div className="w-[500px] h-[300px] rounded-full blur-[120px] opacity-15"
        style={{ background: 'radial-gradient(ellipse, #22c55e, transparent 70%)' }} />
    </div>
  )

  // ── Post-signup: check your email ─────────────────────────────────────
  if (confirmed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4"
        style={{ background: 'linear-gradient(160deg, #07080f 0%, #071a14 50%, #07080f 100%)' }}>
        {glow}
        <div className="relative w-full max-w-sm text-center">
          <Link href="/" className="flex items-center justify-center gap-2 mb-8">
            <img src="/icon.svg" alt="Weblandr" className="w-8 h-8" />
            <span className="font-bold text-xl">Weblandr</span>
          </Link>

          <div className="rounded-2xl p-[1px]"
            style={{ background: 'linear-gradient(135deg, #22c55e30, #ffffff08)' }}>
            <div className="rounded-2xl p-8" style={{ background: '#0d0f1a' }}>

              {/* Icon */}
              <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
                style={{ background: 'linear-gradient(135deg,#22c55e15,#06b6d415)', border: '1px solid #22c55e25' }}>
                <span className="text-3xl">✉️</span>
              </div>

              <h1 className="text-2xl font-bold mb-2">Check your inbox</h1>
              <p className="text-sm text-zinc-400 leading-relaxed mb-2">
                We've sent a confirmation link to
              </p>
              <p className="text-sm font-semibold text-emerald-400 mb-5 break-all">{email}</p>
              <p className="text-sm text-zinc-500 leading-relaxed mb-7">
                Click the link in that email to verify your address and activate your account.
                The link expires in <span className="text-zinc-300">24 hours</span>.
              </p>

              {/* Steps */}
              <div className="text-left space-y-3 mb-7">
                {[
                  { n: '1', text: 'Open the email from Weblandr' },
                  { n: '2', text: 'Click "Confirm account"' },
                  { n: '3', text: 'Subscribe to unlock all features' },
                ].map(s => (
                  <div key={s.n} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e30' }}>
                      {s.n}
                    </span>
                    <span className="text-sm text-zinc-300">{s.text}</span>
                  </div>
                ))}
              </div>

              {/* Resend hint */}
              <p className="text-xs text-zinc-600">
                Didn't receive it? Check your spam folder, or{' '}
                <button
                  onClick={() => { setConfirmed(false); setPassword('') }}
                  className="text-emerald-500 hover:text-emerald-400 transition-colors underline underline-offset-2">
                  try a different email
                </button>.
              </p>
            </div>
          </div>

          <p className="text-center text-sm text-zinc-600 mt-6">
            Already confirmed?{' '}
            <Link href="/login" className="text-emerald-400 hover:text-emerald-300 transition-colors">Sign in</Link>
          </p>
        </div>
      </div>
    )
  }

  // ── Signup form ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(160deg, #07080f 0%, #071a14 50%, #07080f 100%)' }}>
      {glow}

      <div className="relative w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <img src="/icon.svg" alt="Weblandr" className="w-8 h-8" />
          <span className="font-bold text-xl">Weblandr</span>
        </Link>

        <div className="rounded-2xl p-[1px]"
          style={{ background: 'linear-gradient(135deg, #22c55e20, #ffffff08)' }}>
          <div className="rounded-2xl p-8" style={{ background: '#0d0f1a' }}>
            <h1 className="text-2xl font-bold mb-1">Create your account</h1>
            <p className="text-sm text-zinc-500 mb-7">Start extracting emails in minutes</p>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm transition-all outline-none"
                  style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}
                  onFocus={e => e.target.style.borderColor = '#22c55e40'}
                  onBlur={e  => e.target.style.borderColor = '#ffffff10'}
                  placeholder="you@company.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Password</label>
                <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm transition-all outline-none"
                  style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}
                  onFocus={e => e.target.style.borderColor = '#22c55e40'}
                  onBlur={e  => e.target.style.borderColor = '#ffffff10'}
                  placeholder="Min 8 characters" />
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <button type="submit" disabled={loading}
                className="w-full py-3 font-bold text-black rounded-xl text-sm transition-all disabled:opacity-50 mt-2"
                style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
                {loading ? 'Creating account…' : 'Create account →'}
              </button>
            </form>

            {/* Email confirmation notice — shown before submit */}
            <div className="mt-5 flex items-start gap-2.5 rounded-lg px-3 py-3"
              style={{ background: '#0a0c14', border: '1px solid #ffffff08' }}>
              <span className="text-base flex-shrink-0 mt-0.5">📬</span>
              <p className="text-xs text-zinc-500 leading-relaxed">
                We'll send a confirmation email after sign-up.
                Click the link to activate your account.
              </p>
            </div>

            <p className="text-center text-sm text-zinc-600 mt-5">
              Already have an account?{' '}
              <Link href="/login" className="text-emerald-400 hover:text-emerald-300 transition-colors">Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
