/**
 * Per-shop EMBED KEY for the embeddable widget (07 · Embeddable Widget, Sprint 1).
 *
 * Unlike the seller agent token (lib/agent-auth.ts), the embed key is
 * **publishable, not secret** — it ships inside the <script>/snippet on a
 * third-party page, so anyone can read it. Its job is to (a) attribute a widget
 * to a shop, (b) give a stable handle to rate-limit per shop, and (c) let the
 * loader fetch the shop's public identity for theming. It NEVER authorizes a
 * payment or a write — money still flows through the hosted checkout and writes
 * stay Clerk-/agent-token-gated.
 *
 * Because it is public, we store the plaintext (no hashing) — but at TOP-LEVEL
 * `metadata.embed_key`, OUT of `metadata.settings`, so a settings patch (or the
 * store-config MCP tool) can never overwrite or clobber it.
 *
 *     metadata.embed_key            — "emb_pk_<hex>"
 *     metadata.embed_key_created_at — ISO timestamp
 */

import { randomBytes } from 'crypto'
import { db } from './supabase'

export const EMBED_KEY_PREFIX = 'emb_pk_'

/** Public shop identity the widget loader is allowed to see. No PII, no secrets. */
export interface EmbedShop {
  id: string
  slug: string | null
  name: string | null
  verified: boolean | null
  logo_url: string | null
  metadata: Record<string, unknown> | null
}

/** Generate a fresh publishable embed key. */
export function generateEmbedKey(): string {
  return EMBED_KEY_PREFIX + randomBytes(16).toString('hex')
}

/** True if a string is shaped like an embed key (cheap pre-check before a DB hit). */
export function looksLikeEmbedKey(key?: string | null): key is string {
  return typeof key === 'string' && /^emb_pk_[a-f0-9]{32}$/.test(key)
}

/**
 * Read the embed key off a request — query param `?key=` (the snippet form) or
 * the `x-miyagi-embed-key` header. Returns null if absent/malformed.
 */
export function embedKeyFromRequest(req: Request): string | null {
  const url = new URL(req.url)
  const fromQuery = url.searchParams.get('key')
  if (looksLikeEmbedKey(fromQuery)) return fromQuery
  const fromHeader = req.headers.get('x-miyagi-embed-key')
  if (looksLikeEmbedKey(fromHeader)) return fromHeader
  return null
}

/**
 * Is this request coming from the embeddable widget? True when it carries an
 * embed key, the `embed` channel header, or a `?channel=embed` marker. Used to
 * apply the embed rate-limit bucket ONLY to widget traffic on shared endpoints,
 * leaving the marketplace and AI agents unthrottled.
 */
export function isEmbedRequest(req: Request): boolean {
  if (embedKeyFromRequest(req)) return true
  if (req.headers.get('x-miyagi-channel') === 'embed') return true
  try {
    return new URL(req.url).searchParams.get('channel') === 'embed'
  } catch {
    return false
  }
}

/**
 * Resolve an embed key to the shop it belongs to (public fields only), or null.
 * Scoped by construction: a key maps to exactly one shop. The caller decides
 * what to do when null (treat as anonymous, or refuse).
 */
export async function resolveEmbedShop(key?: string | null): Promise<EmbedShop | null> {
  if (!looksLikeEmbedKey(key)) return null

  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, slug, name, verified, logo_url, metadata')
    .eq('metadata->>embed_key', key)
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return data as EmbedShop
}
