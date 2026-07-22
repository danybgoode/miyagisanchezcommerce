/**
 * lib/preview-events.ts
 *
 * Founding merchant consent-safe previews · Sprint 3 — the PURE payload builder for
 * the preview lifecycle events forwarded to the golden-beans Growth Engine.
 *
 * Split from the server emitter (lib/preview-lifecycle.ts) on purpose: the thing
 * that must never regress is that these payloads carry NO merchant PII — no email,
 * no WhatsApp number, no merchant/shop NAME, no raw preview token. Keeping the
 * builder next-free and side-effect-free means a Playwright `api` spec can assert
 * that property directly on the real payload, rather than on a re-declared shim.
 *
 * The event SUBJECT is the shop's mirror UUID. It identifies the merchant subject
 * for funnel analysis without being personal data — the same id already used as the
 * attribution key, and meaningless outside our own database.
 */

/** The canonical lifecycle transitions. One event per successful transition. */
export const PREVIEW_LIFECYCLE_EVENTS = [
  'preview_created',
  'preview_delivered',
  'preview_approved',
  'preview_invalidated',
  'preview_activated',
  'shop_claimed',
] as const

export type PreviewLifecycleEvent = (typeof PREVIEW_LIFECYCLE_EVENTS)[number]

export const PREVIEW_FEATURE_ID = 'founding-merchant-consent-previews'

export interface PreviewEventFacts {
  /** marketplace_shops.id — the non-personal subject key. */
  shopId: string
  /** merchant_previews.id, when the event concerns a preview. */
  previewId?: string | null
  /** The snapshot version the transition applies to. */
  version?: number | null
  /** How many products the proposal covers. A count, never their titles. */
  productCount?: number | null
}

export interface PreviewEventPayload {
  userId: string
  event: PreviewLifecycleEvent
  featureId: string
  tags: Record<string, string | number>
}

/**
 * Build the event payload. Only ids, counts and the version are ever included —
 * the shape is an allow-list, not a redaction pass, so a future caller cannot leak
 * a name or an email by passing extra fields (there is nowhere for them to go).
 */
export function buildPreviewEventPayload(
  event: PreviewLifecycleEvent,
  facts: PreviewEventFacts,
): PreviewEventPayload {
  const tags: Record<string, string | number> = { shop_id: String(facts.shopId ?? '') }
  if (facts.previewId) tags.preview_id = String(facts.previewId)
  if (typeof facts.version === 'number') tags.version = facts.version
  if (typeof facts.productCount === 'number') tags.product_count = facts.productCount

  return {
    userId: String(facts.shopId ?? ''),
    event,
    featureId: PREVIEW_FEATURE_ID,
    tags,
  }
}
