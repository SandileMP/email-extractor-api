import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'

const clientConfig = {
  region: process.env.APP_AWS_REGION || process.env.AWS_REGION || 'eu-west-1',
  ...(process.env.APP_AWS_ACCESS_KEY_ID
    ? {
        credentials: {
          accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY!,
        },
      }
    : {}),
}

const client = new DynamoDBClient(clientConfig)
export const db = DynamoDBDocumentClient.from(client)

export const TABLES = {
  users: process.env.USERS_TABLE || 'scrapify-users',
  apiKeys: process.env.API_KEYS_TABLE || 'scrapify-api-keys',
  subscriptions: process.env.SUBSCRIPTIONS_TABLE || 'scrapify-subscriptions',
}

export function generateApiKey() {
  return `sc_live_${randomUUID().replace(/-/g, '')}`
}

// ── User helpers ──────────────────────────────────────────────────────────

export async function getUser(email: string) {
  const res = await db.send(new GetCommand({ TableName: TABLES.users, Key: { email } }))
  return res.Item as {
    email: string
    password_hash: string
    subscription_status: string
    paystack_customer_code?: string
    created_at: string
  } | undefined
}

export async function createUser(
  email: string,
  passwordHash: string,
) {
  await db.send(
    new PutCommand({
      TableName: TABLES.users,
      Item: {
        email,
        password_hash: passwordHash,
        subscription_status: 'inactive',
        created_at: new Date().toISOString(),
      },
      ConditionExpression: 'attribute_not_exists(email)',
    }),
  )
}

export async function updateUserSubscription(
  email: string,
  status: string,
  customerCode?: string,
) {
  await db.send(
    new UpdateCommand({
      TableName: TABLES.users,
      Key: { email },
      UpdateExpression:
        'SET subscription_status = :s' +
        (customerCode ? ', paystack_customer_code = :c' : ''),
      ExpressionAttributeValues: {
        ':s': status,
        ...(customerCode ? { ':c': customerCode } : {}),
      },
    }),
  )
}

// ── API key helpers ───────────────────────────────────────────────────────

export async function getApiKeyForUser(email: string) {
  const res = await db.send(
    new QueryCommand({
      TableName: TABLES.apiKeys,
      IndexName: 'user_email-index',
      KeyConditionExpression: 'user_email = :e',
      FilterExpression: 'active = :a',
      ExpressionAttributeValues: { ':e': email, ':a': true },
      Limit: 1,
    }),
  )
  return res.Items?.[0] as { api_key: string; user_email: string; active: boolean } | undefined
}

export async function createApiKey(email: string) {
  const key = generateApiKey()
  await db.send(
    new PutCommand({
      TableName: TABLES.apiKeys,
      Item: {
        api_key: key,
        user_email: email,
        active: true,
        created_at: new Date().toISOString(),
      },
    }),
  )
  return key
}

export async function deactivateApiKeysForUser(email: string) {
  const res = await db.send(
    new QueryCommand({
      TableName: TABLES.apiKeys,
      IndexName: 'user_email-index',
      KeyConditionExpression: 'user_email = :e',
      ExpressionAttributeValues: { ':e': email },
    }),
  )
  for (const item of res.Items ?? []) {
    await db.send(
      new UpdateCommand({
        TableName: TABLES.apiKeys,
        Key: { api_key: item.api_key },
        UpdateExpression: 'SET active = :f',
        ExpressionAttributeValues: { ':f': false },
      }),
    )
  }
}

// ── Subscription helpers ──────────────────────────────────────────────────

export async function upsertSubscription(
  subscriptionCode: string,
  email: string,
  customerCode: string,
  status: string,
) {
  await db.send(
    new PutCommand({
      TableName: TABLES.subscriptions,
      Item: {
        subscription_code: subscriptionCode,
        user_email: email,
        customer_code: customerCode,
        status,
        updated_at: new Date().toISOString(),
      },
    }),
  )
}

export async function getSubscriptionByCode(code: string) {
  const res = await db.send(
    new GetCommand({ TableName: TABLES.subscriptions, Key: { subscription_code: code } }),
  )
  return res.Item as { subscription_code: string; user_email: string; customer_code: string; status: string } | undefined
}
