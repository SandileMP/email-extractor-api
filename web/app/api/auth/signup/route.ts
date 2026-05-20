import { NextRequest, NextResponse } from 'next/server'
import { hashPassword, createToken, COOKIE } from '@/lib/auth'
import { createUser } from '@/lib/dynamodb'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ctx = { route: 'POST /api/auth/signup' }

  let body: { email?: string; password?: string }
  try {
    body = await req.json()
  } catch (err) {
    logger.error('Failed to parse request body', err, ctx)
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email, password } = body

  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { error: 'Email and password (min 8 chars) required' },
      { status: 400 },
    )
  }

  const emailLower = email.toLowerCase()
  logger.info('Signup attempt', { ...ctx, email: emailLower })

  try {
    logger.info('Hashing password', ctx)
    const hash = await hashPassword(password)

    logger.info('Writing user to DynamoDB', { ...ctx, email: emailLower })
    await createUser(emailLower, hash)

    logger.info('Creating JWT', ctx)
    const token = await createToken(emailLower)

    logger.info('Signup success', { ...ctx, email: emailLower })
    const res = NextResponse.json({ ok: true })
    res.cookies.set({ ...COOKIE, value: token })
    return res
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      logger.warn('Email already registered', { ...ctx, email: emailLower })
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    logger.error('Signup failed', err, { ...ctx, email: emailLower })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
