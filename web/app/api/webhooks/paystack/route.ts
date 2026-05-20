import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { verifySignature } from '@/lib/paystack'
import { logger } from '@/lib/logger'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.APP_AWS_REGION || 'eu-west-1',
    ...(process.env.APP_AWS_ACCESS_KEY_ID
      ? { credentials: { accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID, secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY! } }
      : {}),
  }),
)

async function writeKeyToDynamo(email: string, userId: string, apiKey: string) {
  await db.send(new PutCommand({
    TableName: process.env.API_KEYS_TABLE || 'meshparse-api-keys',
    Item: { api_key: apiKey, user_email: email, user_id: userId, active: true, created_at: new Date().toISOString() },
  }))
}

async function deactivateKeysInDynamo(email: string) {
  const res = await db.send(new QueryCommand({
    TableName: process.env.API_KEYS_TABLE || 'meshparse-api-keys',
    IndexName: 'user_email-index',
    KeyConditionExpression: 'user_email = :e',
    ExpressionAttributeValues: { ':e': email },
  }))
  for (const item of res.Items ?? []) {
    await db.send(new UpdateCommand({
      TableName: process.env.API_KEYS_TABLE || 'meshparse-api-keys',
      Key: { api_key: item.api_key },
      UpdateExpression: 'SET active = :f',
      ExpressionAttributeValues: { ':f': false },
    }))
  }
}

export async function POST(req: NextRequest) {
  const ctx = { route: 'POST /api/webhooks/paystack' }
  const rawBody = await req.text()
  const signature = req.headers.get('x-paystack-signature') ?? ''

  if (!verifySignature(rawBody, signature)) {
    logger.warn('Invalid webhook signature', ctx)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const { event: type, data } = JSON.parse(rawBody)
  logger.info('Webhook received', { ...ctx, event: type })

  const supabase = createAdminClient()

  try {
    if (type === 'charge.success' && data.plan) {
      const email: string = data.customer.email.toLowerCase()
      const subCode: string = data.subscription_code ?? data.reference
      const customerCode: string = data.customer.customer_code

      // Look up Supabase user by email
      const { data: { users } } = await supabase.auth.admin.listUsers()
      const user = users.find(u => u.email?.toLowerCase() === email)
      if (!user) {
        logger.warn('No Supabase user found for email', { ...ctx, email })
        return NextResponse.json({ received: true })
      }

      // Upsert subscription in Supabase
      await supabase.from('subscriptions').upsert({
        user_id: user.id,
        subscription_code: subCode,
        customer_code: customerCode,
        status: 'active',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'subscription_code' })

      // Create API key if not already active
      const { data: existing } = await supabase
        .from('api_keys').select('api_key').eq('user_id', user.id).eq('active', true).maybeSingle()

      if (!existing) {
        const apiKey = `mp_live_${randomUUID().replace(/-/g, '')}`
        await supabase.from('api_keys').insert({ user_id: user.id, api_key: apiKey, active: true })
        await writeKeyToDynamo(email, user.id, apiKey)
        logger.info('API key created', { ...ctx, email, keyPrefix: apiKey.slice(0, 12) })
      }
    }

    if (type === 'subscription.disable' || type === 'subscription.not_renew') {
      const subCode: string = data.subscription_code
      const { data: sub } = await supabase
        .from('subscriptions').select('user_id, user:user_id(email)').eq('subscription_code', subCode).maybeSingle()

      if (sub) {
        await supabase.from('subscriptions')
          .update({ status: 'inactive', updated_at: new Date().toISOString() })
          .eq('subscription_code', subCode)
        await supabase.from('api_keys').update({ active: false }).eq('user_id', sub.user_id)
        const email = (sub.user as { email: string } | null)?.email ?? ''
        if (email) await deactivateKeysInDynamo(email)
        logger.info('Subscription deactivated', { ...ctx, subCode })
      }
    }
  } catch (err) {
    logger.error('Webhook error', err, { ...ctx, event: type })
    return NextResponse.json({ error: 'Processing error' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
