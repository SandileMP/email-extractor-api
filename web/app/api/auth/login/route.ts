import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ctx = { route: 'POST /api/auth/login' }
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  logger.info('Login attempt', { ...ctx, email })
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    logger.error('Supabase signIn error', error, ctx)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  logger.info('Login success', { ...ctx, userId: data.user.id })
  return NextResponse.json({ ok: true })
}
