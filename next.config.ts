import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
    // Allow Next.js image optimizer to serve WebP/AVIF
    formats: ['image/avif', 'image/webp'],
  },
  async rewrites() {
    return [
      // Well-known discovery → canonical UCP capability manifest, so AI agents
      // can auto-find the API. Served via rewrite (reliable for .well-known).
      { source: '/.well-known/ucp', destination: '/api/ucp/manifest' },
    ]
  },
  async headers() {
    return [
      {
        // The embeddable widget loader is included via <script> from any site, so
        // it must be CORS-open and cacheable. (07 · Embeddable Widget, Sprint 2.)
        source: '/embed.js',
        headers: [
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
    ]
  },
}

export default withSentryConfig(nextConfig, {
  // Sentry org/project set via SENTRY_ORG and SENTRY_PROJECT env vars
  silent: true,                  // suppress verbose build output
  sourcemaps: { disable: false },
  // Route Sentry traffic through /monitoring-tunnel so ad blockers
  // (uBlock, Brave, Privacy Badger…) can't intercept the ingest calls.
  // withSentryConfig auto-creates the API route handler for this path.
  tunnelRoute: '/monitoring-tunnel',
  // Updated from deprecated top-level options (disableLogger, automaticVercelMonitors)
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: true, // create Sentry monitors for Vercel cron jobs
  },
})
