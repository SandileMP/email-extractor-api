type Level = 'info' | 'warn' | 'error'

function log(level: Level, message: string, meta?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta,
  }
  // JSON lines — CloudWatch / Amplify SSR picks these up as structured logs
  if (level === 'error') {
    console.error(JSON.stringify(entry))
  } else {
    console.log(JSON.stringify(entry))
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => {
    const errMeta =
      err instanceof Error
        ? { error: err.message, stack: err.stack, name: err.name }
        : { error: String(err) }
    log('error', msg, { ...errMeta, ...meta })
  },
}
