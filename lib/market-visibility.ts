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

  // The publication label is DERIVED from the registry's marketplace_status, never
  // hardcoded per market. It was once a literal "Marketplace US no disponible" branch,
  // which silently became a falsehood the moment the US marketplace opened — the label
  // must follow the market that opens, not the market that was closed when it was written.
  const code = market.market_code.toUpperCase()
  return Object.freeze({
    operatingMarketCode: market.market_code,
    operatingMarketLabel: `Tienda propia activa · ${code}`,
    marketplacePublicationLabel:
      market.marketplace_status === 'active' ? `Marketplace ${code}` : `Marketplace ${code} no disponible`,
  })
}
