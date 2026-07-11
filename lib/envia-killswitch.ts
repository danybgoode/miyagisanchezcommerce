/**
 * lib/envia-killswitch.ts
 *
 * Frontend mirror of apps/backend/src/lib/envia-killswitch.ts — the pure decision
 * seam for the platform Envía kill-switch (`shipping.envia_enabled`, enablement
 * polarity / default OFF — see lib/flags.ts). Kept free of `next/*` / `server-only`
 * so it is directly unit-testable (mirrors lib/checkout-killswitch.ts).
 *
 * The BACKEND is the real enforcement (rates + label routes). This FE seam covers
 * the legacy in-app order routes that still call lib/envia.ts directly
 * (app/api/orders/[id]/ship) so they can't bypass the kill, and gives the seller-
 * settings banner one source of truth.
 *
 * Shipping-provider-expansion · Sprint 2: a granted tenant (`seller.metadata.envia_grant`,
 * comp-grant precedent) rides Envía even while the platform flag stays OFF —
 * `sellerGranted` is a second, independent passthrough alongside `enviaEnabled`.
 */

/** Quote-side graceful fallback copy (`{ rates: [], message }`) → arranged delivery. */
export const ENVIA_ARRANGED_DELIVERY_MESSAGE =
  'Las paqueterías no tienen cobertura para ese destino. Puedes coordinar la entrega directamente con el vendedor.'

/** Label-side 422 copy → manual carrier. Mirrors the backend message verbatim. */
export const ENVIA_LABEL_DISABLED_MESSAGE =
  'El envío automático con Envía no está disponible por ahora. Usa paquetería manual.'

export type EnviaKillSwitch = {
  /** `shipping.envia_enabled` — when false, all Envía carrier calls are blocked. */
  enviaEnabled: boolean
  /** `seller.metadata.envia_grant` present — a per-tenant comp override, independent of the platform flag. */
  sellerGranted: boolean
}

export type EnviaGateDecision =
  | { blocked: false }
  | { blocked: true; reason: 'platform_envia_disabled' }

/** Platform ON, or a granted seller, → passthrough; neither → blocked. Pure; never throws. */
export function enviaKillGate({ enviaEnabled, sellerGranted }: EnviaKillSwitch): EnviaGateDecision {
  return enviaEnabled || sellerGranted
    ? { blocked: false }
    : { blocked: true, reason: 'platform_envia_disabled' }
}
