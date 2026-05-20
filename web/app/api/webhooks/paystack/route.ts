import { NextRequest, NextResponse } from 'next/server'
import { verifySignature } from '@/lib/paystack'
import {
  updateUserSubscription,
  createApiKey,
  deactivateApiKeysForUser,
  upsertSubscription,
  getSubscriptionByCode,
  getApiKeyForUser,
} from '@/lib/dynamodb'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ctx = { route: 'POST /api/webhooks/paystack' }

  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''

  if (!verifySignature(rawBody, signature)) {
    logger.warn('Invalid Paystack webhook signature', ctx)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const { event: type, data } = event
  logger.info('Paystack webhook received', { ...ctx, event: type })

  try {
    if (type === 'charge.success' && data.plan) {
      const email: string = data.customer.email.toLowerCase()
      const subCode: string = data.subscription_code ?? data.reference
      const customerCode: string = data.customer.customer_code

      logger.info('Processing charge.success', { ...ctx, email, subCode })
      await upsertSubscription(subCode, email, customerCode, 'active')
      await updateUserSubscription(email, 'active', customerCode)

      const existing = await getApiKeyForUser(email)
      if (!existing) {
        const key = await createApiKey(email)
        logger.info('API key created', { ...ctx, email, keyPrefix: key.slice(0, 12) })
      } else {
        logger.info('API key already exists', { ...ctx, email })
      }
    }

    if (type === 'subscription.disable' || type === 'subscription.not_renew') {
      const subCode: string = data.subscription_code
      logger.info('Processing subscription disable', { ...ctx, subCode })
      const sub = await getSubscriptionByCode(subCode)
      if (sub) {
        await upsertSubscription(subCode, sub.user_email, sub.customer_code, 'inactive')
        await updateUserSubscription(sub.user_email, 'inactive')
        await deactivateApiKeysForUser(sub.user_email)
        logger.info('Subscription deactivated', { ...ctx, email: sub.user_email })
      }
    }
  } catch (err) {
    logger.error('Webhook processing error', err, { ...ctx, event: type })
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
