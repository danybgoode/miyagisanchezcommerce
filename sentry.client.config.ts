import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,         // 10% of transactions

  // Reduce noise from expected errors
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error exception captured',
    'AbortError',
  ],
})
