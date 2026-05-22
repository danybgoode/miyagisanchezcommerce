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
}

export default withSentryConfig(nextConfig, {
  // Sentry org/project set via SENTRY_ORG and SENTRY_PROJECT env vars
  silent: true,                  // suppress verbose build output
  sourcemaps: { disable: false },
  disableLogger: true,
  automaticVercelMonitors: true, // create Sentry monitors for Vercel cron jobs
})
