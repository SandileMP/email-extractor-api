import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { initializeTransaction } from '@/lib/paystack'

export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await initializeTransaction(session.email)

  if (!result.status) {
    console.error('Paystack error:', result)
    return NextResponse.json({ error: 'Could not initialize payment' }, { status: 502 })
  }

  return NextResponse.json({ url: result.data.authorization_url })
}
