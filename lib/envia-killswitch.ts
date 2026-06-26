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
}

export type EnviaGateDecision =
  | { blocked: false }
  | { blocked: true; reason: 'platform_envia_disabled' }

/** ON → passthrough, OFF → blocked. Pure; never throws. */
export function enviaKillGate({ enviaEnabled }: EnviaKillSwitch): EnviaGateDecision {
  return enviaEnabled
    ? { blocked: false }
    : { blocked: true, reason: 'platform_envia_disabled' }
}
