import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Cloud Run container (09-platform-infra
  // frontend-vercel-to-cloudrun, S1.2). Vercel ignores `output: 'standalone'`
  // and keeps using its own build output, so this is a no-op there.
  output: 'standalone',
  images: {
    // 09-platform-infra/hyper-performant-website S1.1 — the built-in `/_next/image`
    // optimizer 500s/400s under `output: 'standalone'` (open upstream Next.js
    // regression, vercel/next.js#82610 — confirmed against this exact Dockerfile,
    // see that commit's message and lib/image-loader.ts's header comment). A
    // CUSTOM loader bypasses `/_next/image` entirely, so `remotePatterns`/`formats`
    // below are vestigial under this mode (Next ignores them for a custom loader)
    // but left in place as documentation of intent + a cheap revert path if the
    // upstream bug is ever fixed.
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
    formats: ['image/avif', 'image/webp'],
    loader: 'custom',
    loaderFile: './lib/image-loader.ts',
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
      {
        // The full-shop embed surface must be framable by ANY site (it's the
        // whole point). frame-ancestors * is the modern directive; no global
        // X-Frame-Options is set, so nothing to override. (US-5.)
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
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
