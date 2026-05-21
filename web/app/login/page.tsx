'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (err) setError('Invalid email or password')
    else router.push('/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'linear-gradient(160deg, #07080f 0%, #071a14 50%, #07080f 100%)' }}>
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[500px] h-[300px] rounded-full blur-[120px] opacity-15"
          style={{ background: 'radial-gradient(ellipse, #22c55e, transparent 70%)' }} />
      </div>

      <div className="relative w-full max-w-sm">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <img src="/icon.svg" alt="MeshParse" className="w-8 h-8" />
          <span className="font-bold text-xl">MeshParse</span>
        </Link>

        <div className="rounded-2xl p-[1px]"
          style={{ background: 'linear-gradient(135deg, #22c55e20, #ffffff08)' }}>
          <div className="rounded-2xl p-8" style={{ background: '#0d0f1a' }}>
            <h1 className="text-2xl font-bold mb-1">Welcome back</h1>
            <p className="text-sm text-zinc-500 mb-7">Sign in to your account</p>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Email</label>
                <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm transition-all outline-none"
                  style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}
                  onFocus={e => e.target.style.borderColor = '#22c55e40'}
                  onBlur={e => e.target.style.borderColor = '#ffffff10'}
                  placeholder="you@company.com" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5 uppercase tracking-wider">Password</label>
                <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm transition-all outline-none"
                  style={{ background: '#0a0c14', border: '1px solid #ffffff10', color: 'white' }}
                  onFocus={e => e.target.style.borderColor = '#22c55e40'}
                  onBlur={e => e.target.style.borderColor = '#ffffff10'}
                  placeholder="Your password" />
              </div>
              {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
              <button type="submit" disabled={loading}
                className="w-full py-3 font-bold text-black rounded-xl text-sm transition-all disabled:opacity-50 mt-2"
                style={{ background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}>
                {loading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>

            <p className="text-center text-sm text-zinc-600 mt-6">
              No account?{' '}
              <Link href="/signup" className="text-emerald-400 hover:text-emerald-300 transition-colors">Create one free</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
