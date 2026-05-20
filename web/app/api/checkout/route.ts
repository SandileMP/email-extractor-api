import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { initializeTransaction } from '@/lib/paystack'
import { logger } from '@/lib/logger'

export async function POST() {
  const ctx = { route: 'POST /api/checkout' }
  const supabase = await createClient()

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  logger.info('Initializing Paystack transaction', { ...ctx, userId: user.id })
  const result = await initializeTransaction(user.email!)
  logger.info('Paystack response', { ...ctx, status: result.status, message: result.message })

  if (!result.status) {
    logger.error('Paystack init failed', undefined, { ...ctx, message: result.message })
    return NextResponse.json({ error: 'Could not initialize payment' }, { status: 502 })
  }

  return NextResponse.json({ url: result.data.authorization_url })
}
