import { redirect } from 'next/navigation'
import { createClient } from '@/utils/supabase/server'
import DashboardClient from './client'

export default async function Dashboard() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: keyRow }, { data: sub }] = await Promise.all([
    supabase.from('api_keys').select('api_key').eq('user_id', user.id).eq('active', true).maybeSingle(),
    supabase.from('subscriptions').select('status').eq('user_id', user.id).maybeSingle(),
  ])

  return (
    <DashboardClient
      email={user.email ?? ''}
      subscriptionStatus={sub?.status ?? 'inactive'}
      apiKey={keyRow?.api_key ?? null}
    />
  )
}
