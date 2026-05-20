import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { initializeTransaction } from '@/lib/paystack'
import { logger } from '@/lib/logger'

export async function POST() {
  const ctx = { route: 'POST /api/checkout' }

  try {
    const session = await getSession()
    if (!session) {
      logger.warn('Unauthenticated checkout attempt', ctx)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    logger.info('Initializing Paystack transaction', { ...ctx, email: session.email })
    const result = await initializeTransaction(session.email)
    logger.info('Paystack response', { ...ctx, status: result.status, message: result.message })

    if (!result.status) {
      logger.error('Paystack initialization failed', undefined, {
        ...ctx,
        paystackMessage: result.message,
      })
      return NextResponse.json({ error: 'Could not initialize payment' }, { status: 502 })
    }

    return NextResponse.json({ url: result.data.authorization_url })
  } catch (err) {
    logger.error('Checkout error', err, ctx)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
