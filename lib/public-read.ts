import 'server-only'

import { isShopClaimed, type ClaimableShop } from '@/lib/claim'
import { isShopPreviewPrivateForShop } from '@/lib/preview-access'

export const PUBLIC_READ_PREFIX = '/internal-public-read'
export const PUBLIC_PREVIEW_PREFIX = '/internal-owner-preview'

export type PublicReadChannel = 'marketplace' | 'subdomain' | 'embed'

export function isPublicReadChannel(value: string): value is PublicReadChannel {
  return value === 'marketplace' || value === 'subdomain' || value === 'embed'
}

export type PublicReadShop = ClaimableShop & {
  slug: string
  clerk_user_id: string | null
}

export type PublicReadEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'unclaimed' | 'preview-private' }

/**
 * D10/D19 cache eligibility. This composes the shipped claim and preview-access
 * rules; it deliberately defines no competing privacy or ownership predicate.
 */
export async function publicReadEligibility(
  shop: PublicReadShop,
): Promise<PublicReadEligibility> {
  if (await isShopPreviewPrivateForShop(shop)) {
    return { eligible: false, reason: 'preview-private' }
  }
  if (!isShopClaimed(shop)) return { eligible: false, reason: 'unclaimed' }
  return { eligible: true }
}

export function publicReadPath(args: {
  channel: PublicReadChannel
  identity: string
  shopSlug: string
  surface: 'shop' | 'listing'
  tail?: string
}): string {
  const base = [
    PUBLIC_READ_PREFIX,
    encodeURIComponent(args.channel),
    encodeURIComponent(args.identity),
    encodeURIComponent(args.shopSlug),
    args.surface,
  ].join('/')
  return args.tail ? `${base}/${args.tail.split('/').map(encodeURIComponent).join('/')}` : base
}

export function isInternalPublicPath(pathname: string): boolean {
  return pathname === PUBLIC_READ_PREFIX ||
    pathname.startsWith(`${PUBLIC_READ_PREFIX}/`) ||
    pathname === PUBLIC_PREVIEW_PREFIX ||
    pathname.startsWith(`${PUBLIC_PREVIEW_PREFIX}/`)
}
