/**
 * Per-shop agent authentication for the seller-side MCP write-tools (Sprint 4).
 *
 * A seller provisions a bearer token in their "Agentes" settings. We show the
 * plaintext ONCE and persist only its SHA-256 hash at
 * `marketplace_shops.metadata.ucp_agent_token_hash` (top-level metadata, kept
 * OUT of `metadata.settings` so it can never leak through the config read tool
 * or be overwritten by a settings patch). The agent then sends:
 *
 *     Authorization: Bearer ms_agent_<hex>
 *
 * Scoped by construction: a token resolves to exactly one shop, so a token for
 * shop A can never touch shop B.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { db } from './supabase'

const TOKEN_PREFIX = 'ms_agent_'

export interface AgentShop {
  id: string
  clerk_user_id: string
  name: string | null
  slug: string | null
  description: string | null
  location: string | null
  logo_url: string | null
  metadata: Record<string, unknown> | null
}

/** Generate a fresh agent token. Returns the plaintext (show once) + its hash. */
export function generateAgentToken(): { token: string; hash: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('hex')
  return { token, hash: hashAgentToken(token) }
}

/** SHA-256 hex of a token. Deterministic — used for storage and lookup. */
export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Pull the raw token out of an `Authorization: Bearer …` header, if well-formed. */
export function parseBearer(authHeader?: string | null): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  const token = m?.[1]?.trim()
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null
  return token
}

/**
 * Resolve an `Authorization` header to the shop it represents, or null.
 * Looks the shop up by the stored token hash; constant-time compares the hash
 * to avoid leaking timing information on the (already hashed) value.
 */
export async function resolveAgentShop(authHeader?: string | null): Promise<AgentShop | null> {
  const token = parseBearer(authHeader)
  if (!token) return null
  const hash = hashAgentToken(token)

  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, clerk_user_id, name, slug, description, location, logo_url, metadata')
    .eq('metadata->>ucp_agent_token_hash', hash)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  // Defensive: re-verify the stored hash with a constant-time compare.
  const stored = (data.metadata as Record<string, unknown> | null)?.ucp_agent_token_hash
  if (typeof stored !== 'string') return null
  const a = Buffer.from(stored)
  const b = Buffer.from(hash)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return data as AgentShop
}
