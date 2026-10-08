import { isMarketCode } from './markets'

type CreatedSeller = {
  id: string
  name: string
  slug: string
  metadata?: Record<string, unknown> | null
}

/** The persisted Medusa market decides language; an unknown market cannot be guessed. */
export function planShopCreatedWelcome(seller: CreatedSeller, email: string | null) {
  const market = seller.metadata?.operating_market
  if (!isMarketCode(market)) return { ok: false as const, reason: 'market_unavailable' as const }
  if (!email) return { ok: false as const, reason: 'recipient_unavailable' as const }
  return {
    ok: true as const,
    context: { to: email, shopName: seller.name, shopSlug: seller.slug, sellerId: seller.id, market },
  }
}
