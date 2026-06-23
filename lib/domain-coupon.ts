/**
 * lib/domain-coupon.ts
 *
 * The PURE seam for the custom-domain campaign coupon `miyagisan` (epic 07 ·
 * custom-domain-paywall, Sprint 3 — the World-Cup acquisition giveaway). The
 * coupon comps the FIRST YEAR of the custom-domain subscription (100% off the
 * first interval, then it renews at the standard $499 MXN/yr) and is capped at
 * 100 total redemptions — the 101st is refused.
 *
 * The coupon itself lives in STRIPE (a Coupon + Promotion Code on the platform
 * account); Stripe enforces the cap authoritatively via `max_redemptions`. This
 * module holds only the PURE, next-free decision logic — code matching, the
 * redeemable/refusal rules, and the display counter — so the Playwright `api`
 * runner can unit-test the cap-of-100 boundary directly (no Stripe, no network).
 * The Stripe side lives in `lib/domain-coupon-server.ts`.
 *
 * Mirrors the `domain-entitlement.ts` (pure) / `domain-entitlement-server.ts`
 * (server) split used elsewhere in this epic.
 */

/** The single campaign code. Lowercase canonical form. */
export const CAMPAIGN_COUPON_CODE = 'miyagisan'

/** Total redemptions allowed across the whole campaign. The 101st is refused. */
export const CAMPAIGN_COUPON_CAP = 100

/** Why a campaign-coupon application was refused (null ⇒ not refused). */
export type CouponRefusalReason = 'exhausted' | 'unknown'

/** Normalize buyer/seller-typed input: trim + lowercase so " MIYAGISAN " matches. */
export function normalizeCouponCode(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : ''
}

/** True iff the input (after normalization) is the campaign code. */
export function isCampaignCode(input: unknown): boolean {
  return normalizeCouponCode(input) === CAMPAIGN_COUPON_CODE
}

/**
 * Is the campaign coupon still redeemable, given Stripe's live counters?
 * `active` is the promotion-code/coupon active flag; `timesRedeemed` and
 * `maxRedemptions` come straight from the Stripe coupon. Mirrors Stripe's own
 * server-side rule so our pre-check message matches what Stripe would enforce.
 */
export function couponRedeemable(input: {
  active: boolean
  timesRedeemed: number
  maxRedemptions: number
}): boolean {
  if (!input.active) return false
  return input.timesRedeemed < input.maxRedemptions
}

/**
 * Decide whether an applied code is refused and why.
 *  - not the campaign code ⇒ 'unknown'
 *  - campaign code but exhausted/inactive ⇒ 'exhausted'
 *  - otherwise ⇒ null (proceed)
 */
export function couponRefusalReason(
  input: unknown,
  status: { active: boolean; timesRedeemed: number; maxRedemptions: number },
): CouponRefusalReason | null {
  if (!isCampaignCode(input)) return 'unknown'
  return couponRedeemable(status) ? null : 'exhausted'
}

/** Display counter for the admin console, e.g. "7/100". */
export function formatRedemptionCount(redeemed: number, cap: number = CAMPAIGN_COUPON_CAP): string {
  return `${Math.max(0, redeemed)}/${cap}`
}

/** es-MX message for a refused application, by reason. */
export function couponRefusalMessage(reason: CouponRefusalReason): string {
  return reason === 'exhausted'
    ? `Se agotó el cupón “${CAMPAIGN_COUPON_CODE}”. Ya no hay años gratis disponibles.`
    : 'Cupón no válido.'
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Stripe failure classification (mint-fix epic, Sprint 1 · S1.1)
 *
 * The admin coupon tool used to mask EVERY Stripe failure as "coupon not minted
 * yet" — a missing-key/wrong-mode/restricted-key error looked identical to a
 * coupon that genuinely doesn't exist. These PURE helpers (no Stripe SDK, no
 * network) let the server distinguish a real "resource missing" (→ null/EMPTY)
 * from an auth/permission/connection failure (→ surfaced), and map a failure to
 * a sanitized es-MX admin message that NEVER echoes the key or raw secret.
 *
 * The server side extracts the duck-typed fields off the caught Stripe error and
 * calls these — so the whole decision is unit-testable on the Playwright api runner.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Classified kind of a Stripe failure (drives the surfaced admin message). */
export type StripeFailureKind = 'missing' | 'auth' | 'permission' | 'connection' | 'rate_limit' | 'unknown'

/**
 * The key-free, duck-typed subset of a Stripe error we classify on. Stripe's
 * `StripeError` carries `type` (constructor name, e.g. `StripeAuthenticationError`),
 * `rawType` (snake_case, e.g. `authentication_error`), `code` (e.g. `resource_missing`),
 * and `statusCode` (the HTTP status). None of these contain the secret key.
 */
export interface StripeErrorShape {
  statusCode?: number | null
  code?: string | null
  type?: string | null
  rawType?: string | null
}

/**
 * Classify a Stripe failure on multiple robust signals — HTTP status first, then
 * the `code`/`type`/`rawType` fallbacks — so it stays correct regardless of the
 * exact constructor-name casing across SDK versions.
 *   - resource missing / 404 ⇒ 'missing'  (coupon legitimately not created yet)
 *   - 401 / authentication    ⇒ 'auth'     (key missing, invalid, or wrong mode)
 *   - 403 / permission         ⇒ 'permission' (restricted key lacks coupon scope)
 *   - connection               ⇒ 'connection'
 *   - 429 / rate limit         ⇒ 'rate_limit'
 *   - otherwise                ⇒ 'unknown'
 */
export function classifyStripeFailure(e: StripeErrorShape): StripeFailureKind {
  const status = e.statusCode ?? null
  const code = e.code ?? ''
  const type = (e.type ?? '').toLowerCase()
  const rawType = (e.rawType ?? '').toLowerCase()

  if (code === 'resource_missing' || status === 404) return 'missing'
  if (status === 401 || type.includes('authentication') || rawType.includes('authentication')) return 'auth'
  if (status === 403 || type.includes('permission')) return 'permission'
  if (type.includes('connection')) return 'connection'
  if (status === 429 || type.includes('ratelimit') || rawType.includes('rate_limit')) return 'rate_limit'
  return 'unknown'
}

/**
 * True only for a genuine "resource missing" — the one case the read path may map
 * to null/EMPTY (the coupon hasn't been minted yet). Every other kind is surfaced.
 */
export function isResourceMissing(e: StripeErrorShape): boolean {
  return classifyStripeFailure(e) === 'missing'
}

/**
 * Sanitized es-MX admin message for a Stripe failure kind. Our OWN copy — never
 * Stripe's raw message (which can echo a redacted key) — so nothing leaks. Each
 * message names the likely cause so Daniel can tell apart a missing key, a
 * wrong-mode key, and a permission problem from the admin surface alone.
 */
export function describeStripeFailure(kind: StripeFailureKind): string {
  switch (kind) {
    case 'missing':
      return 'El cupón aún no existe en Stripe.'
    case 'auth':
      return 'La llave de Stripe (STRIPE_SECRET_KEY) falta o no es válida en este entorno (revisa que sea del modo correcto: prod = sk_live…).'
    case 'permission':
      return 'La llave de Stripe no tiene permiso para administrar cupones (se requiere escritura en Cupones y Códigos de promoción).'
    case 'connection':
      return 'No se pudo conectar con Stripe. Intenta de nuevo en un momento.'
    case 'rate_limit':
      return 'Stripe está limitando las solicitudes. Espera unos segundos e intenta de nuevo.'
    default:
      return 'Stripe rechazó la operación. Revisa los registros para el detalle.'
  }
}
