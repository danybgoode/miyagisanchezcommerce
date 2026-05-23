/**
 * Next.js client-side instrumentation hook (introduced in Next.js 15.3).
 *
 * This file runs EXCLUSIVELY in the browser — never on the server — which
 * makes it the correct place to initialize browser-only SDKs like Sentry.
 * It executes after the HTML document loads but before React hydration.
 *
 * Why not a 'use client' component: client components are still SSR'd during
 * static prerendering, so browser-only APIs (replayIntegration, etc.) crash.
 * This file convention bypasses that entirely.
 *
 * Why not withSentryConfig webpack injection: Next.js 16+ uses Turbopack,
 * which skips webpack plugins — the injection never happens.
 *
 * Docs: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client
 *       https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */
import './sentry.client.config'
