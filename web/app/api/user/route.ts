import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getUser, getApiKeyForUser } from '@/lib/dynamodb'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [user, keyRecord] = await Promise.all([
    getUser(session.email),
    getApiKeyForUser(session.email),
  ])

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  return NextResponse.json({
    email: user.email,
    subscription_status: user.subscription_status,
    api_key: keyRecord?.api_key ?? null,
  })
}
