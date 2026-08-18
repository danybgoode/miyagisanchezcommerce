import 'server-only'

/**
 * Living Shop — what each optional section actually has behind it (epic 07, Story 3.2).
 *
 * A nav link is rendered where the seller's CONFIG and the shop's DATA agree, so
 * something has to answer the data half. This does — once per render, from
 * values the page has already fetched wherever possible, so a coherent nav costs
 * one extra query (events) rather than five.
 *
 * `policies` is derived, not authored: the shop has a Políticas page exactly when
 * the existing Devoluciones setting yields a real returns window. There is no
 * `policies` field in settings and adding one would fork the truth — the same
 * reason the shipped `/politicas` route already gates on `returnsWindowLabel`.
 */

import { db } from '@/lib/supabase'
import { authoredAboutBody, wellFormedFaqItems } from '@/lib/shop-content'
import { returnsWindowLabel } from '@/lib/trust-signals'
import type { SectionAvailability } from './types'

export interface AvailabilityInputs {
  /** The Supabase mirror row's id — `marketplace_events.shop_id` references it. */
  shopId: string | null
  settings: Record<string, unknown>
  /** Collections the page already resolved; passing them avoids a second read. */
  collectionCount: number
}

export async function resolveSectionAvailability(input: AvailabilityInputs): Promise<SectionAvailability> {
  const about = input.settings.about as { body?: string } | null | undefined
  const faq = input.settings.faq as { items?: Array<{ question?: string; answer?: string }> } | null | undefined
  const returnsPolicy = input.settings.returns_policy as { window?: string } | null | undefined

  return {
    collections: input.collectionCount > 0,
    events: await hasPublicEvents(input.shopId),
    about: !!authoredAboutBody(about),
    faq: wellFormedFaqItems(faq?.items).length > 0,
    policies: !!returnsWindowLabel(returnsPolicy?.window),
  }
}

/**
 * Whether this shop has at least one event worth a destination.
 *
 * "Upcoming and not cancelled" is the bar: an Events nav item that opens onto a
 * list of things that already happened is a dead link wearing a label. A shop
 * with only past events therefore has no Events section, and that is correct —
 * the section returns when they schedule the next one.
 *
 * On a read failure this answers FALSE, and that is a deliberate fail-closed
 * choice with a bounded consequence: the nav item is missing for one render.
 * The alternative — assuming events exist — produces a link to an empty page,
 * which is the worse of the two failures.
 */
async function hasPublicEvents(shopId: string | null): Promise<boolean> {
  if (!shopId) return false
  const { data, error } = await db
    .from('marketplace_events')
    .select('id')
    .eq('shop_id', shopId)
    .eq('status', 'active')
    .gte('starts_at', new Date().toISOString())
    .limit(1)
  if (error) {
    console.error('[shop-sections] event availability unavailable:', error.message)
    return false
  }
  return (data ?? []).length > 0
}
