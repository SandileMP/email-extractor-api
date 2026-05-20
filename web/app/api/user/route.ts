import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [{ data: keyRow }, { data: sub }] = await Promise.all([
    supabase
      .from('api_keys')
      .select('api_key')
      .eq('user_id', user.id)
      .eq('active', true)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  return NextResponse.json({
    email: user.email,
    subscription_status: sub?.status ?? 'inactive',
    api_key: keyRow?.api_key ?? null,
  })
}
