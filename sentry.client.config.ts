import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Replay captures sessions — 10% of sessions, 100% on error
  // Note: autoSessionTracking removed in v8+; sessions are always tracked automatically
  integrations: [
    Sentry.replayIntegration(),
  ],

  tracesSampleRate: 0.1,         // 10% of transactions
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Reduce noise from expected errors
  ignoreErrors: [
    'ResizeObserver loop',
    'Non-Error exception captured',
    'AbortError',
  ],
})
