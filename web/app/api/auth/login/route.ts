import { NextRequest, NextResponse } from 'next/server'
import { verifyPassword, createToken, COOKIE } from '@/lib/auth'
import { getUser } from '@/lib/dynamodb'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const user = await getUser(email.toLowerCase())
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const token = await createToken(user.email)
  const res = NextResponse.json({ ok: true })
  res.cookies.set({ ...COOKIE, value: token })
  return res
}
