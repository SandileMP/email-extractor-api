import { NextRequest, NextResponse } from 'next/server'
import { hashPassword, createToken, COOKIE } from '@/lib/auth'
import { createUser } from '@/lib/dynamodb'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password || password.length < 8) {
    return NextResponse.json({ error: 'Email and password (min 8 chars) required' }, { status: 400 })
  }

  try {
    const hash = await hashPassword(password)
    await createUser(email.toLowerCase(), hash)

    const token = await createToken(email.toLowerCase())
    const res = NextResponse.json({ ok: true })
    res.cookies.set({ ...COOKIE, value: token })
    return res
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
    }
    console.error(err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
