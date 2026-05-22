/**
 * Next.js instrumentation hook — required for Sentry server-side error capture.
 * Without this file, @sentry/nextjs only captures client-side errors.
 * Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}
