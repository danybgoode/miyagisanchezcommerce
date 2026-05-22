/**
 * Rate limiting via Upstash Redis.
 *
 * Env vars required (set in Vercel + .env.local):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * If not configured, all limits pass through silently (local dev / cold start).
 */

import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'

// ── Lazy singleton ─────────────────────────────────────────────────────────────

let _redis: Redis | null = null
function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null
  if (!_redis) {
    _redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  }
  return _redis
}

// ── Limit configs ──────────────────────────────────────────────────────────────

// Offers: max 10 per IP per hour — prevents spam offers
const offerLimiter = () => {
  const redis = getRedis()
  if (!redis) return null
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '1 h'),  prefix: 'rl:offers' })
}

// Checkout: max 20 per IP per 10 min — prevents checkout abuse
const checkoutLimiter = () => {
  const redis = getRedis()
  if (!redis) return null
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, '10 m'), prefix: 'rl:checkout' })
}

// MCP: max 120 per IP per minute — per-agent reasonable limit
const mcpLimiter = () => {
  const redis = getRedis()
  if (!redis) return null
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(120, '1 m'), prefix: 'rl:mcp' })
}

// Supply import: max 5 batch imports per IP per hour — prevents bulk abuse
const supplyImportLimiter = () => {
  const redis = getRedis()
  if (!redis) return null
  return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 h'), prefix: 'rl:supply' })
}

// ── Public helper ──────────────────────────────────────────────────────────────

export type LimitKey = 'offers' | 'checkout' | 'mcp' | 'supply_import'

/**
 * Check rate limit for a given key and identifier (usually IP address).
 * Returns { allowed: true } if passes or if Redis is unconfigured.
 * Returns { allowed: false, retryAfter: number } if blocked.
 */
export async function checkRateLimit(
  key: LimitKey,
  identifier: string,
): Promise<{ allowed: true } | { allowed: false; retryAfter: number; limit: number; remaining: number }> {
  const getLimiter = key === 'offers' ? offerLimiter
    : key === 'checkout' ? checkoutLimiter
    : key === 'mcp'      ? mcpLimiter
    : supplyImportLimiter

  const limiter = getLimiter()
  if (!limiter) return { allowed: true }   // Redis not configured — pass through

  try {
    const { success, limit, remaining, reset } = await limiter.limit(identifier)
    if (success) return { allowed: true }
    return {
      allowed:    false,
      retryAfter: Math.ceil((reset - Date.now()) / 1000),
      limit,
      remaining,
    }
  } catch {
    return { allowed: true }   // Redis error — fail open, never block business logic
  }
}

/**
 * Get the real IP from a Next.js request, respecting Vercel's forwarded headers.
 */
export function getClientIp(req: Request): string {
  const headers = new Headers((req as Request & { headers: Headers }).headers)
  return (
    headers.get('x-real-ip') ??
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '127.0.0.1'
  )
}
