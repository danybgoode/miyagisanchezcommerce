/**
 * Read-only labels for the operating-market projection.
 *
 * The input must come from the public Medusa seller projection, validated by
 * `readPublicSellerMarket`; a Supabase mirror can enumerate a shop but must
 * never decide its market or publication state. Keeping this tiny derivation
 * pure lets the partner, admin, and MCP surfaces tell the same truthful story.
 */
import type { MarketCode } from './markets'
import type { PublicSellerMarket } from './owned-market'

export interface MarketVisibility {
  readonly operatingMarketCode: MarketCode | null
  readonly operatingMarketLabel: string
  readonly marketplacePublicationLabel: string
}

export function marketVisibility(market: PublicSellerMarket | null): MarketVisibility {
  if (!market) {
    return Object.freeze({
      operatingMarketCode: null,
      operatingMarketLabel: 'Mercado operativo no disponible',
      marketplacePublicationLabel: 'Estado de marketplace no disponible',
    })
  }

  if (market.market_code === 'mx') {
    return Object.freeze({
      operatingMarketCode: 'mx',
      operatingMarketLabel: 'Tienda propia activa · MX',
      marketplacePublicationLabel: 'Marketplace MX',
    })
  }

  return Object.freeze({
    operatingMarketCode: 'us',
    operatingMarketLabel: 'Tienda propia activa · US',
    marketplacePublicationLabel: 'Marketplace US no disponible',
  })
}
