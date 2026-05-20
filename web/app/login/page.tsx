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
    if (err) {
      setError('Invalid credentials')
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="block text-center text-xl font-bold text-brand mb-8">MeshParse</Link>
        <div className="bg-zinc-900 border border-white/5 rounded-2xl p-8">
          <h1 className="text-xl font-bold mb-1">Welcome back</h1>
          <p className="text-sm text-zinc-400 mb-6">Sign in to your account</p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-300 mb-1">Email</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-brand transition-colors"
                placeholder="you@company.com" />
            </div>
            <div>
              <label className="block text-sm text-zinc-300 mb-1">Password</label>
              <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-brand transition-colors"
                placeholder="Your password" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-brand text-black font-semibold rounded-lg hover:bg-green-400 disabled:opacity-50 transition-colors text-sm">
              {loading ? 'Signing in…' : 'Sign in →'}
            </button>
          </form>
          <p className="text-center text-sm text-zinc-500 mt-6">
            No account?{' '}
            <Link href="/signup" className="text-brand hover:underline">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
