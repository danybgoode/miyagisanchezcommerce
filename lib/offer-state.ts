import { db } from '@/lib/supabase'
import { cancelScheduledEmail } from '@/lib/email'

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

export async function resolveMarketplaceListingId(listingId?: string | null): Promise<string | null> {
  if (!listingId) return null

  const { data: byMedusa } = await db
    .from('marketplace_listings')
    .select('id')
    .eq('medusa_product_id', listingId)
    .maybeSingle()
  if (byMedusa?.id) return byMedusa.id

  if (!isUuid(listingId)) return null
  const { data: byId } = await db
    .from('marketplace_listings')
    .select('id')
    .eq('id', listingId)
    .maybeSingle()
  return byId?.id ?? null
}

export async function markListingPurchased({
  listingId,
  offerId,
}: {
  listingId?: string | null
  offerId?: string | null
}) {
  let mirrorListingId = await resolveMarketplaceListingId(listingId)

  if (offerId) {
    const { data: paidOffer } = await db
      .from('marketplace_offers')
      .select('listing_id, scheduled_reminder_ids')
      .eq('id', offerId)
      .maybeSingle()

    if (paidOffer?.listing_id) mirrorListingId = paidOffer.listing_id

    await db.from('marketplace_offers').update({ status: 'paid' }).eq('id', offerId)

    const reminders = (paidOffer?.scheduled_reminder_ids ?? {}) as Record<string, string>
    if (reminders.buyer_payment_expiry) {
      cancelScheduledEmail(reminders.buyer_payment_expiry).catch(() => {})
    }
  }

  if (!mirrorListingId) return

  let competingOffers = db.from('marketplace_offers')
    .update({ status: 'declined' })
    .eq('listing_id', mirrorListingId)
    .in('status', ['pending', 'countered', 'accepted'])
  if (offerId) competingOffers = competingOffers.neq('id', offerId)
  await competingOffers

  await db.from('marketplace_listings')
    .update({ status: 'sold' })
    .eq('id', mirrorListingId)
}
