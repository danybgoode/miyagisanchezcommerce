'use client'

/**
 * Forces the Sentry browser SDK to initialize on every page load.
 *
 * Next.js 16+ uses Turbopack for production builds, which bypasses
 * the webpack plugin that @sentry/nextjs normally uses to auto-inject
 * sentry.client.config.ts. Without this component in the root layout
 * the client-side SDK never loads, meaning: no sessions, no replays,
 * no browser-originated errors — only server traces work.
 *
 * This is a side-effect-only import: it renders nothing and runs
 * Sentry.init() exactly once per browser session.
 */
import '../sentry.client.config'

export default function SentryInit() {
  return null
}
