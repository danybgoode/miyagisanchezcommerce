/** Decisions shared by campaign invitation creation and redemption. No I/O. */
import type { ClaimPayload } from './claimJwt'

export type ClaimPurpose = 'campaign' | 'promoter' | 'public' | 'removal'
export type ClaimMarket = 'mx' | 'us'

export type ClaimShopFacts = {
  id: string
  slug: string
  clerkUserId: string | null
  market: ClaimMarket | null
  status: 'active' | 'paused' | 'deleted' | null
}

export type ClaimDecision =
  | { ok: true; newlyClaimable: boolean }
  | { ok: false; reason: 'review_required' | 'wrong_email' | 'wrong_shop' | 'wrong_market' | 'shop_unavailable' | 'already_claimed' }

export function normalizedClaimEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

/**
 * The public form cannot prove merchant ownership: anybody can type an email.
 * Campaign and promoter invitations require a vetted contact, and redemption
 * still requires that EXACT email to be verified on the authenticated account.
 */
export function decideClaimRedemption(
  token: ClaimPayload,
  shop: ClaimShopFacts,
  actor: { clerkUserId: string; verifiedEmails: readonly string[] },
): ClaimDecision {
  if (token.purpose !== 'campaign' && token.purpose !== 'promoter') {
    return { ok: false, reason: 'review_required' }
  }
  const invited = normalizedClaimEmail(token.email)
  if (!invited || !actor.verifiedEmails.some((email) => normalizedClaimEmail(email) === invited)) {
    return { ok: false, reason: 'wrong_email' }
  }
  if (token.shopId !== shop.id || token.shopSlug !== shop.slug) {
    return { ok: false, reason: 'wrong_shop' }
  }
  if (token.market && token.market !== shop.market) {
    return { ok: false, reason: 'wrong_market' }
  }
  if (shop.status !== 'active') {
    return { ok: false, reason: 'shop_unavailable' }
  }
  if (shop.clerkUserId && shop.clerkUserId !== actor.clerkUserId) {
    return { ok: false, reason: 'already_claimed' }
  }
  return { ok: true, newlyClaimable: shop.clerkUserId === null }
}

export function buildClaimLandingUrl(token: string, origin = 'https://miyagisanchez.com'): string {
  const url = new URL('/claim', origin)
  url.searchParams.set('token', token)
  return url.toString()
}

export function buildRemovalLandingUrl(token: string, origin = 'https://miyagisanchez.com'): string {
  const url = new URL('/remove-shop', origin)
  url.searchParams.set('token', token)
  return url.toString()
}
