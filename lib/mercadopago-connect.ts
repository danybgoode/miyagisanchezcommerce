/**
 * MercadoPago Marketplace OAuth — seller account connection.
 *
 * Mirrors the Stripe Connect pattern (lib/stripe.ts + /api/stripe/connect/*):
 * sellers authorize the platform application, and we store their per-seller
 * credentials in marketplace_shops.metadata.settings.mercadopago (synced to the
 * Medusa seller). Checkout then creates preferences ON BEHALF OF the seller with
 * a marketplace_fee, so funds settle directly into the seller's MP account.
 *
 * Docs: https://www.mercadopago.com.mx/developers/en/docs/split-payments
 *   - Authorization: https://auth.mercadopago.com/authorization
 *   - Token:         POST https://api.mercadopago.com/oauth/token
 *   - Code TTL 10 min; access_token TTL 180 days; refresh_token provided.
 */

import { createHash, randomBytes } from 'node:crypto'

const MP_AUTH_URL = 'https://auth.mercadopago.com/authorization'
const MP_OAUTH_TOKEN_URL = 'https://api.mercadopago.com/oauth/token'

/** Generate a PKCE verifier + S256 challenge (MP applications require PKCE). */
export function generateMpPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url') // 43-char, RFC 7636 compliant
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export interface ShopMercadoPagoSettings {
  /** Seller's MP collector/user id. */
  user_id?: string | number
  /** Seller's MP access token (secret) — used to create preferences on their behalf. */
  access_token?: string
  refresh_token?: string
  public_key?: string
  /** ISO timestamp when access_token expires. */
  expires_at?: string
  /** True once OAuth completed. */
  connected?: boolean
  /** Seller can pause MP without disconnecting. */
  enabled?: boolean
  /** Whether tokens are from the live or test MP application. */
  live_mode?: boolean
}

export interface MpTokenResponse {
  access_token: string
  refresh_token: string
  user_id: number
  public_key: string
  expires_in: number
  token_type: string
  scope?: string
  live_mode?: boolean
}

export function getMpAppCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.MP_CLIENT_ID
  const clientSecret = process.env.MP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Missing MP_CLIENT_ID / MP_CLIENT_SECRET environment variables')
  }
  return { clientId, clientSecret }
}

/** True when running against the MP test application (sandbox). */
export function isMpTestMode(): boolean {
  return process.env.MP_OAUTH_TEST === 'true'
}

export function getShopMercadoPago(metadata: Record<string, unknown> | null): ShopMercadoPagoSettings {
  const settings = (metadata?.settings ?? {}) as Record<string, unknown>
  return (settings.mercadopago ?? {}) as ShopMercadoPagoSettings
}

/**
 * A seller can accept MP only once connected and not paused.
 * NOTE: checks the `connected` flag only (not access_token) — the token is
 * stripped from public seller metadata for security, and the backend
 * (start-checkout) is the authoritative gate that verifies the real token.
 */
export function sellerHasMpConnected(metadata: Record<string, unknown> | null): boolean {
  const mp = getShopMercadoPago(metadata)
  return !!(mp.connected && mp.enabled !== false)
}

export function buildMpAuthorizationUrl(params: { state: string; redirectUri: string; codeChallenge: string }): string {
  const { clientId } = getMpAppCredentials()
  const qs = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    platform_id: 'mp',
    state: params.state,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  })
  return `${MP_AUTH_URL}?${qs.toString()}`
}

/** Exchange an authorization code for seller tokens. */
export async function exchangeMpCode(params: { code: string; redirectUri: string; codeVerifier?: string }): Promise<MpTokenResponse> {
  const { clientId, clientSecret } = getMpAppCredentials()
  const body: Record<string, unknown> = {
    client_id: clientId,
    client_secret: clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    ...(params.codeVerifier ? { code_verifier: params.codeVerifier } : {}),
  }
  if (isMpTestMode()) body.test_token = true

  const res = await fetch(MP_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.access_token) {
    throw new Error(`MP token exchange failed: ${res.status} ${JSON.stringify(json)}`)
  }
  return json as MpTokenResponse
}

/** Refresh an expiring seller access token. */
export async function refreshMpToken(refreshToken: string): Promise<MpTokenResponse> {
  const { clientId, clientSecret } = getMpAppCredentials()
  const res = await fetch(MP_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json?.access_token) {
    throw new Error(`MP token refresh failed: ${res.status} ${JSON.stringify(json)}`)
  }
  return json as MpTokenResponse
}

/** Build the persisted settings object from a token response. */
export function mpSettingsFromToken(token: MpTokenResponse, prev?: ShopMercadoPagoSettings): ShopMercadoPagoSettings {
  return {
    ...prev,
    user_id: token.user_id,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    public_key: token.public_key,
    expires_at: new Date(Date.now() + (token.expires_in ?? 0) * 1000).toISOString(),
    connected: true,
    // A fresh OAuth connect is always enabled. (Don't inherit prev.enabled —
    // Desconectar sets enabled:false, which a reconnect must not carry over,
    // or the MP button stays hidden via the `enabled !== false` gate.)
    enabled: true,
    live_mode: token.live_mode ?? !isMpTestMode(),
  }
}
