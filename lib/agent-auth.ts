/**
 * Per-shop agent authentication for the seller-side MCP write-tools (Sprint 4),
 * extended (Sprint 2 of seller-agent-connect-mcp-url) with a second credential
 * shape for the always-on personal MCP URL.
 *
 * Two credential shapes, ONE resolver (`resolveAgentShop`) — both scoped by
 * construction to exactly one shop, so either credential for shop A can never
 * touch shop B:
 *
 *  - **Bearer token** (`ms_agent_<hex>`): a seller provisions it in "Agentes"
 *    settings. Shown ONCE; only its SHA-256 hash is persisted at
 *    `marketplace_shops.metadata.ucp_agent_token_hash`. Sent as
 *    `Authorization: Bearer ms_agent_<hex>` by Claude Desktop / CLI clients.
 *  - **Connector slug** (`ms_connector_<opaque>`): the personal MCP URL's
 *    credential (`/api/ucp/mcp/c/<slug>` — see that route). Unlike the Bearer
 *    token this is stored PLAINTEXT at `metadata.ucp_agent_connector_slug` —
 *    deliberately, because the panel must always be able to re-show the URL,
 *    which a hash can't support. The URL route never talks to the DB itself;
 *    it synthesizes `Authorization: Bearer ms_connector_<slug>` and calls the
 *    exact same shared MCP dispatcher, so this resolver is the only place
 *    either credential shape is ever turned into a shop.
 *
 * Both metadata keys live top-level (kept OUT of `metadata.settings` so
 * neither can leak through the config read tool or be overwritten by a
 * settings patch).
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { db } from './supabase'

const TOKEN_PREFIX = 'ms_agent_'
export const CONNECTOR_PREFIX = 'ms_connector_'

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

/**
 * Generate a fresh connector slug for the always-on personal MCP URL.
 * 192 bits of entropy, URL-safe. Stored PLAINTEXT (see file header) — rotating
 * simply overwrites the stored value, which is what invalidates the old URL.
 */
export function generateConnectorSlug(): string {
  return randomBytes(24).toString('base64url')
}

/** Pull the raw credential out of an `Authorization: Bearer …` header, if well-formed. */
export function parseBearer(authHeader?: string | null): string | null {
  if (!authHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim())
  const token = m?.[1]?.trim()
  if (!token) return null
  if (!token.startsWith(TOKEN_PREFIX) && !token.startsWith(CONNECTOR_PREFIX)) return null
  return token
}

/**
 * Which credential shape a (already-parsed) Bearer value is, or null if neither.
 * Pure — no DB, no I/O — so the shape-dispatch is unit-testable on its own.
 */
export function classifyAgentCredential(token: string): 'bearer' | 'connector' | null {
  if (token.startsWith(TOKEN_PREFIX)) return 'bearer'
  if (token.startsWith(CONNECTOR_PREFIX)) return 'connector'
  return null
}

/**
 * Resolve an `Authorization` header to the shop it represents, or null.
 * Branches on credential shape (see file header), then looks the shop up by
 * the stored hash (Bearer) or stored slug (connector); constant-time compares
 * the resolved value in both branches to avoid leaking timing information.
 */
export async function resolveAgentShop(authHeader?: string | null): Promise<AgentShop | null> {
  const token = parseBearer(authHeader)
  if (!token) return null

  if (classifyAgentCredential(token) === 'connector') {
    const slug = token.slice(CONNECTOR_PREFIX.length)
    if (!slug) return null

    const { data, error } = await db
      .from('marketplace_shops')
      .select('id, clerk_user_id, name, slug, description, location, logo_url, metadata')
      .eq('metadata->>ucp_agent_connector_slug', slug)
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    const stored = (data.metadata as Record<string, unknown> | null)?.ucp_agent_connector_slug
    if (typeof stored !== 'string') return null
    const a = Buffer.from(stored)
    const b = Buffer.from(slug)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    return data as AgentShop
  }

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
