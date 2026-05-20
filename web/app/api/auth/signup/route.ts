import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ctx = { route: 'POST /api/auth/signup' }
  const { email, password } = await req.json()

  if (!email || !password || password.length < 8) {
    return NextResponse.json({ error: 'Email and password (min 8 chars) required' }, { status: 400 })
  }

  logger.info('Signup attempt', { ...ctx, email })
  const supabase = await createClient()

  const { data, error } = await supabase.auth.signUp({ email, password })

  if (error) {
    logger.error('Supabase signUp error', error, ctx)
    const status = error.status ?? 500
    return NextResponse.json({ error: error.message }, { status })
  }

  logger.info('Signup success', { ...ctx, userId: data.user?.id })
  return NextResponse.json({ ok: true })
}
