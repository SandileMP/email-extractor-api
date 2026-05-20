import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, createToken, COOKIE } from '@/lib/auth'
import { getUser } from '@/lib/dynamodb'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ctx = { route: 'POST /api/auth/login' }

  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch (err) {
    logger.error('Failed to parse request body', err, ctx)
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email, password } = body

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const emailLower = email.toLowerCase()
  logger.info('Login attempt', { ...ctx, email: emailLower })

  try {
    logger.info('Fetching user from DynamoDB', { ...ctx, email: emailLower })
    const user = await getUser(emailLower)

    if (!user) {
      logger.warn('User not found', { ...ctx, email: emailLower })
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    logger.info('Verifying password', ctx)
    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      logger.warn('Password mismatch', { ...ctx, email: emailLower })
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = await createToken(user.email)
    logger.info('Login success', { ...ctx, email: emailLower })
    const res = NextResponse.json({ ok: true })
    res.cookies.set({ ...COOKIE, value: token })
    return res
  } catch (err) {
    logger.error('Login failed', err, { ...ctx, email: emailLower })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
