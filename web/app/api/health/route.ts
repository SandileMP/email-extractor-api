import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { logger } from '@/lib/logger'

export async function GET() {
  const ctx = { route: 'GET /api/health' }
  const checks: Record<string, string> = {}

  // Env var presence
  checks.JWT_SECRET = process.env.JWT_SECRET ? 'set' : 'MISSING'
  checks.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ? 'set' : 'MISSING'
  checks.PAYSTACK_PLAN_CODE = process.env.PAYSTACK_PLAN_CODE ?? 'MISSING'
  checks.APP_AWS_ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID
    ? `set (${process.env.APP_AWS_ACCESS_KEY_ID.slice(0, 8)}…)`
    : 'MISSING'
  checks.APP_AWS_SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY ? 'set' : 'MISSING'
  checks.APP_AWS_REGION = process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? 'MISSING'
  checks.USERS_TABLE = process.env.USERS_TABLE ?? 'MISSING'
  checks.API_KEYS_TABLE = process.env.API_KEYS_TABLE ?? 'MISSING'
  checks.SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE ?? 'MISSING'
  checks.NODE_ENV = process.env.NODE_ENV ?? 'unknown'
  checks.NODE_VERSION = process.version

  // DynamoDB — use GetItem on the users table (within policy scope)
  try {
    const client = DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: process.env.APP_AWS_REGION || 'eu-west-1',
        ...(process.env.APP_AWS_ACCESS_KEY_ID
          ? {
              credentials: {
                accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY!,
              },
            }
          : {}),
      }),
    )
    // GetItem on a non-existent key — succeeds if auth + table access works
    await client.send(
      new GetCommand({
        TableName: process.env.USERS_TABLE || 'meshparse-users',
        Key: { email: '__health_check__' },
      }),
    )
    checks.dynamodb = 'ok'
  } catch (err) {
    logger.error('DynamoDB health check failed', err, ctx)
    checks.dynamodb = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  }

  // Module imports
  for (const mod of ['bcryptjs', 'jose']) {
    try {
      await import(mod)
      checks[mod] = 'ok'
    } catch (err) {
      checks[mod] = `IMPORT_FAILED: ${String(err)}`
    }
  }

  // bcrypt functional test
  try {
    const bcrypt = await import('bcryptjs')
    const hash = await bcrypt.hash('test', 10)
    const valid = await bcrypt.compare('test', hash)
    checks.bcryptjs_functional = valid ? 'ok' : 'hash_mismatch'
  } catch (err) {
    checks.bcryptjs_functional = `FAILED: ${String(err)}`
  }

  logger.info('Health check complete', { ...ctx, checks })

  const missing = Object.entries(checks).filter(([, v]) => v.startsWith('MISSING') || v.startsWith('IMPORT_FAILED') || v.startsWith('FAILED') || (!['ok', 'set'].includes(v) && v.includes('Error')))
  return NextResponse.json(
    { status: missing.length === 0 ? 'ok' : 'degraded', checks, issues: missing.map(([k]) => k) },
    { status: missing.length === 0 ? 200 : 500 },
  )
}
