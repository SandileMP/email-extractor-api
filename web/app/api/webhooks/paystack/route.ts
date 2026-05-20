import { NextRequest, NextResponse } from 'next/server'
import { verifySignature } from '@/lib/paystack'
import {
  updateUserSubscription,
  createApiKey,
  deactivateApiKeysForUser,
  upsertSubscription,
  getSubscriptionByCode,
} from '@/lib/dynamodb'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const { event: type, data } = event

  try {
    if (type === 'charge.success' && data.plan) {
      // New subscription payment or renewal
      const email: string = data.customer.email.toLowerCase()
      const subCode: string = data.subscription_code ?? data.reference
      const customerCode: string = data.customer.customer_code

      await upsertSubscription(subCode, email, customerCode, 'active')
      await updateUserSubscription(email, 'active', customerCode)

      // Create API key if user doesn't already have one
      const { getApiKeyForUser } = await import('@/lib/dynamodb')
      const existing = await getApiKeyForUser(email)
      if (!existing) {
        await createApiKey(email)
      }
    }

    if (type === 'subscription.disable' || type === 'subscription.not_renew') {
      const subCode: string = data.subscription_code
      const sub = await getSubscriptionByCode(subCode)
      if (sub) {
        await upsertSubscription(subCode, sub.user_email, sub.customer_code, 'inactive')
        await updateUserSubscription(sub.user_email, 'inactive')
        await deactivateApiKeysForUser(sub.user_email)
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err)
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
