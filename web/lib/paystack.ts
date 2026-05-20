import crypto from 'crypto'

const BASE = 'https://api.paystack.co'

async function call(method: string, path: string, body?: object) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

export async function initializeTransaction(email: string) {
  return call('POST', '/transaction/initialize', {
    email,
    amount: 75000, // R750.00 in cents
    currency: 'ZAR',
    plan: process.env.PAYSTACK_PLAN_CODE,
    callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?payment=success`,
    metadata: { user_email: email },
  })
}

export function verifySignature(rawBody: string, signature: string): boolean {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
    .update(rawBody)
    .digest('hex')
  return hash === signature
}
