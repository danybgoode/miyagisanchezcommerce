import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, getPriceGrid, formatPrice } from '@/lib/listings'
import { unitPriceCentsFor } from '@/lib/price-grid'
import { isShopClaimed } from '@/lib/claim'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { clampTicketQuantity } from '@/lib/ticket-quantity'
import { readEventDetails } from '@/lib/event-listing'
import CheckoutExperience from './CheckoutExperience'
import type { CheckoutProvider } from '@/lib/cart'

type SearchParams = {
  listingId?: string
  offerId?: string
  provider?: CheckoutProvider
  /** Event admissions: how many tickets to buy (clamped to remaining seats). */
  qty?: string
  /** Specific variant for a multi-variant (print-configurator) listing. */
  variantId?: string
  /** Tenant custom domain the buyer hopped from (own-channel checkout). */
  origin?: string
}

function formatCents(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

async function resolvePublicListingId(listingId: string) {
  if (listingId.startsWith('prod_')) return listingId

  const { data } = await db
    .from('marketplace_listings')
    .select('medusa_product_id')
    .eq('id', listingId)
    .maybeSingle()

  return data?.medusa_product_id ?? listingId
}

async function getAcceptedOfferPrice(offerId: string | undefined, listingId: string, buyerUserId: string) {
  if (!offerId) return null

  const { data: offer } = await db
    .from('marketplace_offers')
    .select(`
      id, status, offer_amount_cents, counter_amount_cents, checkout_expires_at,
      marketplace_listings!inner(id, medusa_product_id)
    `)
    .eq('id', offerId)
    .eq('buyer_clerk_user_id', buyerUserId)
    .maybeSingle()

  if (!offer || offer.status !== 'accepted') return null
  const mirror = offer.marketplace_listings as unknown as { id?: string | null; medusa_product_id?: string | null } | { id?: string | null; medusa_product_id?: string | null }[]
  const mirrorListing = Array.isArray(mirror) ? mirror[0] : mirror
  const medusaProductId = mirrorListing?.medusa_product_id
  const mirrorId = mirrorListing?.id
  if (medusaProductId !== listingId && mirrorId !== listingId) return null
  if (offer.checkout_expires_at && new Date(offer.checkout_expires_at).getTime() < Date.now()) return null

  return offer.counter_amount_cents ?? offer.offer_amount_cents
}

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const rawListingId = params.listingId
  if (!rawListingId) redirect('/l')
  const listingId = await resolvePublicListingId(rawListingId)

  const user = await currentUser()
  if (!user) redirect(`/sign-in?redirect_url=${encodeURIComponent(`/checkout?listingId=${listingId}${params.offerId ? `&offerId=${params.offerId}` : ''}${params.provider ? `&provider=${params.provider}` : ''}${params.qty ? `&qty=${params.qty}` : ''}${params.variantId ? `&variantId=${params.variantId}` : ''}${params.origin ? `&origin=${encodeURIComponent(params.origin)}` : ''}`)}`)

  const listing = await getListing(listingId)
  if (!listing) notFound()

  // Last-line money-path guard: /checkout is directly URL-reachable (the deep-link
  // target of checkoutHopHref/signInHopHref), so an unclaimed (gem) shop must be
  // redirected away even though the PDP no longer links here. Shared predicate —
  // see lib/claim.ts (same one the PDP + offers route + checkout-session use).
  const isClaimed = isShopClaimed(listing.shop)
  if (!isClaimed || listing.shop?.clerk_user_id === user.id) redirect(`/l/${listing.id}`)

  const offerPriceCents = await getAcceptedOfferPrice(params.offerId, listing.id, user.id)
  if (params.offerId && !offerPriceCents) redirect(`/l/${listing.id}?offer=unavailable`)
  let amountCents = offerPriceCents ?? listing.price_cents
  if (!amountCents || amountCents <= 0) redirect(`/l/${listing.id}`)
  if (listing.status !== 'active') redirect(`/l/${listing.id}?checkout=unavailable`)
  // Block checkout for sold-out (Medusa-managed) items — backend reserves stock on
  // order placement, so this saves the buyer a failed add-to-cart at the rail.
  if (listing.in_stock === false) redirect(`/l/${listing.id}?checkout=unavailable`)

  // Payment + delivery availability is resolved by Medusa via the checkout-options
  // endpoint (CheckoutExperience fetches it). The page only carries listing context.
  const image = listing.images?.[0]?.url ?? null
  const isOfferCheckout = !!offerPriceCents
  const isDigital = listing.listing_type === 'digital'

  // Event admissions: buy N in one checkout (kill-switch + aforo clamped). Scoped
  // to EVENT listings only — buy-N is an admissions feature, so a crafted ?qty=N
  // on a non-event product still checks out a single unit. An accepted-offer
  // checkout is always a single unit too. Defaults to 1 everywhere else.
  const isEventListing = !!readEventDetails(listing)
  const quantityEnabled = (await isEnabled('events.quantity_enabled')) && isEventListing
  const quantity = isOfferCheckout
    ? 1
    : clampTicketQuantity(params.qty ?? 1, { available: listing.available_quantity, enabled: quantityEnabled })

  // Multi-variant (print-configurator) listing: `listing.price_cents` is the
  // MIN across all variants (a "desde $X" display price, see toListingShape),
  // not necessarily the price of the buyer's chosen combination. Resolve the
  // exact tier-correct unit price for variantId + quantity from the same
  // price-grid the PDP buy box showed, so the checkout total can never drift
  // from what the buyer saw (house rule: pay-button total = summary). Falls
  // back to the already-validated amountCents if the grid/variant/tier is
  // unresolvable (stale link, tier removed) rather than block checkout.
  if (params.variantId && !isOfferCheckout) {
    const priceGrid = await getPriceGrid(listing.id)
    const resolved = priceGrid ? unitPriceCentsFor(priceGrid, params.variantId, quantity) : null
    if (resolved != null) amountCents = resolved
  }

  return (
    <main className="max-w-[760px] mx-auto px-4 py-5 md:py-8">
      <div style={{ marginBottom: 18 }}>
        <Link href={`/l/${listing.id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none' }}>
          <i className="iconoir-arrow-left" style={{ fontSize: 16 }} />
          Volver al anuncio
        </Link>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
          <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>Revisar compra</h1>
            <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 4 }}>Confirma el precio, entrega y método de pago antes de continuar.</p>
          </div>
          <div style={{ padding: 16, display: 'flex', gap: 12 }}>
            <div style={{ width: 88, height: 88, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-sunk)', flexShrink: 0 }}>
              {image ? <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : null}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3 }}>{listing.title}</p>
              <p style={{ fontSize: 13, color: 'var(--fg-muted)', marginTop: 3 }}>{listing.shop?.name}</p>
              {isOfferCheckout ? (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--success)' }}>Precio acordado</p>
                  <p style={{ fontSize: 22, fontWeight: 800 }}>{formatCents(amountCents, listing.currency)}</p>
                  {listing.price_cents && <p style={{ fontSize: 12, color: 'var(--fg-muted)' }}>Original: <span style={{ textDecoration: 'line-through' }}>{formatPrice(listing)}</span></p>}
                </div>
              ) : (
                <p style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>
                  {formatCents(amountCents, listing.currency)}
                  {quantity > 1 && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-muted)' }}> × {quantity}</span>}
                </p>
              )}
            </div>
          </div>
        </section>

        <CheckoutExperience
          listingId={listing.id}
          variantId={params.variantId}
          sellerId={listing.shop!.id}
          amountCents={amountCents}
          currency={listing.currency}
          quantity={quantity}
          listingType={listing.listing_type}
          isDigital={isDigital}
          offerId={params.offerId}
          offerAmountCents={offerPriceCents ?? undefined}
          originDomain={params.origin}
        />
      </div>
    </main>
  )
}
