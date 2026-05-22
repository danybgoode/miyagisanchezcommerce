import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  tracesSampleRate: 0.1,

  // Capture all unhandled rejections in API routes
  // Vercel source maps uploaded via SENTRY_AUTH_TOKEN
})
