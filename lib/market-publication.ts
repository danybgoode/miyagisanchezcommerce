/**
 * Publication boundary for seller-agent writers.
 *
 * An owned shop may operate in a market before that market's marketplace opens.
 * Only the complete, validated public Medusa seller projection can authorize a
 * marketplace publication; an unreadable projection is deliberately unavailable
 * rather than a reason to inherit the legacy MX marketplace.
 */
import type { PublicSellerMarket } from './owned-market'

export function agentMarketplacePublicationBlock(market: PublicSellerMarket | null): string | null {
  if (!market) {
    return 'No se puede publicar en el marketplace porque no pudimos verificar el mercado operativo de tu tienda. Tu tienda propia no cambia; verifica la configuración del mercado antes de volver a intentarlo.'
  }

  if (market.marketplace_status !== 'active') {
    return `El marketplace de ${market.market_code.toUpperCase()} aún no está disponible para publicar. Tu tienda propia sigue activa; conserva o gestiona ahí tu catálogo y no actives publicaciones hasta que el marketplace abra.`
  }

  return null
}
