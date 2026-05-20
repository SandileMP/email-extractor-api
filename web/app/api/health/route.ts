import { NextResponse } from 'next/server'
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { logger } from '@/lib/logger'

export async function GET() {
  const ctx = { route: 'GET /api/health' }

  const checks: Record<string, string> = {}

  // Env var presence (values redacted)
  checks.JWT_SECRET = process.env.JWT_SECRET ? 'set' : 'MISSING'
  checks.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY ? 'set' : 'MISSING'
  checks.PAYSTACK_PLAN_CODE = process.env.PAYSTACK_PLAN_CODE ?? 'MISSING'
  checks.APP_AWS_ACCESS_KEY_ID = process.env.APP_AWS_ACCESS_KEY_ID ? 'set' : 'MISSING'
  checks.APP_AWS_SECRET_ACCESS_KEY = process.env.APP_AWS_SECRET_ACCESS_KEY ? 'set' : 'MISSING'
  checks.APP_AWS_REGION = process.env.APP_AWS_REGION ?? process.env.AWS_REGION ?? 'MISSING'
  checks.USERS_TABLE = process.env.USERS_TABLE ?? 'MISSING'
  checks.API_KEYS_TABLE = process.env.API_KEYS_TABLE ?? 'MISSING'
  checks.SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE ?? 'MISSING'

  // DynamoDB connectivity
  try {
    const client = new DynamoDBClient({
      region: process.env.APP_AWS_REGION || process.env.AWS_REGION || 'eu-west-1',
      ...(process.env.APP_AWS_ACCESS_KEY_ID
        ? {
            credentials: {
              accessKeyId: process.env.APP_AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.APP_AWS_SECRET_ACCESS_KEY!,
            },
          }
        : {}),
    })
    await client.send(new ListTablesCommand({ Limit: 1 }))
    checks.dynamodb = 'ok'
  } catch (err) {
    logger.error('DynamoDB health check failed', err, ctx)
    checks.dynamodb = err instanceof Error ? err.message : String(err)
  }

  // bcryptjs import
  try {
    await import('bcryptjs')
    checks.bcryptjs = 'ok'
  } catch (err) {
    checks.bcryptjs = 'IMPORT_FAILED: ' + String(err)
  }

  // jose import
  try {
    await import('jose')
    checks.jose = 'ok'
  } catch (err) {
    checks.jose = 'IMPORT_FAILED: ' + String(err)
  }

  logger.info('Health check', { ...ctx, checks })

  const allOk = Object.values(checks).every((v) => v === 'ok' || v === 'set' || !v.startsWith('MISSING'))
  return NextResponse.json({ status: allOk ? 'ok' : 'degraded', checks }, {
    status: allOk ? 200 : 500,
  })
}
