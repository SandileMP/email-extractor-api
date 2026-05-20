import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { getUser, getApiKeyForUser } from '@/lib/dynamodb'
import DashboardClient from './client'

export default async function Dashboard() {
  const session = await getSession()
  if (!session) redirect('/login')

  const [user, keyRecord] = await Promise.all([
    getUser(session.email),
    getApiKeyForUser(session.email),
  ])

  if (!user) redirect('/login')

  return (
    <DashboardClient
      email={user.email}
      subscriptionStatus={user.subscription_status}
      apiKey={keyRecord?.api_key ?? null}
    />
  )
}
