import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

export async function GET() {
  const ctx = { route: 'GET /api/health' }
  const checks: Record<string, string> = {}

  checks.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING'
  checks.SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ? 'set' : 'MISSING'
  checks.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING'
  checks.PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ? 'set' : 'MISSING'
  checks.PAYSTACK_PLAN = process.env.PAYSTACK_PLAN_CODE ?? 'MISSING'
  checks.API_KEYS_TABLE = process.env.API_KEYS_TABLE ?? 'MISSING'
  checks.NODE_VERSION = process.version
  checks.NODE_ENV = process.env.NODE_ENV ?? 'unknown'

  // Supabase connectivity
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    )
    const { error } = await supabase.from('api_keys').select('id').limit(1)
    checks.supabase_db = error ? `ERROR: ${error.message}` : 'ok'
  } catch (err) {
    logger.error('Supabase health check failed', err, ctx)
    checks.supabase_db = `FAILED: ${String(err)}`
  }

  logger.info('Health check', { ...ctx, checks })

  const issues = Object.entries(checks)
    .filter(([, v]) => v.startsWith('MISSING') || v.startsWith('ERROR') || v.startsWith('FAILED'))
    .map(([k]) => k)

  return NextResponse.json(
    { status: issues.length === 0 ? 'ok' : 'degraded', checks, issues },
    { status: issues.length === 0 ? 200 : 500 },
  )
}
