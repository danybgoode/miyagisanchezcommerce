/**
 * The secret-strip invariant for shop metadata.
 *
 * `marketplace_shops.metadata` carries two kinds of secret that must NEVER reach
 * the client settings component:
 *   1. `ucp_agent_token_hash` (+ its created-at) — the hashed MCP/agent token; the
 *      server only ever exposes a boolean "a token is set".
 *   2. `settings.mercadopago.{access_token, refresh_token}` — the seller's MP OAuth
 *      credentials.
 *
 * This was an inline IIFE in `[section]/page.tsx`; lifted into a next-free pure
 * function so the Playwright `api` runner can assert the invariant directly
 * (`e2e/shop-settings-secret-strip.spec.ts`). Behavior is byte-for-byte what the
 * inline version produced.
 */

/** Strip MP OAuth tokens + the hashed agent token from shop metadata before it reaches the client. */
export function stripShopSecrets(
  metadata: Record<string, any> | null | undefined,
): Record<string, any> | null {
  let m = (metadata ?? null) as Record<string, any> | null
  if (m && ('ucp_agent_token_hash' in m || 'ucp_agent_token_created_at' in m)) {
    const { ucp_agent_token_hash: _h, ucp_agent_token_created_at: _c, ...rest } = m
    m = rest
  }
  const mp = (m?.settings as any)?.mercadopago
  if (!mp) return m
  const { access_token: _a, refresh_token: _r, ...safeMp } = mp
  return { ...m, settings: { ...(m as any).settings, mercadopago: safeMp } }
}
