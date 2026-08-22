'use client'

import { useAuth } from '@clerk/nextjs'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import AskSellerButton from '@/app/components/AskSellerButton'
import FavoriteButton from '@/app/components/FavoriteButton'
import MakeOfferButton from '@/app/components/MakeOfferButton'
import OfferCheckoutButton from '@/app/components/OfferCheckoutButton'
import { checkoutHopHref, signInHopHref } from '@/lib/checkout-hop'
import type { PdpViewerState } from '@/lib/pdp-viewer-state'

type Props = {
  listing: {
    id: string
    title: string
    priceCents: number | null
    priceLabel: string
    currency: string
    imageUrl: string | null
  }
  shopSlug: string
  marketBasePath: '/mx'
  customDomain: string | null
  canBuy: boolean
  canOffer: boolean
}

/**
 * D8's single, fixed action region. Static HTML contains only the reserved,
 * disabled state; ownership/buy/offer/favorite assertions appear after the one
 * authenticated endpoint read succeeds.
 */
export default function PublicPdpViewerIsland({
  listing,
  shopSlug,
  marketBasePath,
  customDomain,
  canBuy,
  canOffer,
}: Props) {
  const { isLoaded } = useAuth()
  const started = useRef(false)
  const [state, setState] = useState<PdpViewerState | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!isLoaded || started.current) return
    started.current = true
    const query = new URLSearchParams({ listingId: listing.id, shopSlug })
    void fetch(`/api/public/pdp-viewer-state?${query.toString()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`viewer state ${response.status}`)
        return response.json() as Promise<PdpViewerState>
      })
      .then(setState)
      .catch(() => setFailed(true))
  }, [isLoaded, listing.id, shopSlug])

  const frameStyle: React.CSSProperties = {
    height: 260,
    overflow: 'auto',
    padding: 16,
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    background: 'var(--bg-elevated)',
  }

  if (!state) {
    return (
      <section data-testid="pdp-viewer-state" data-state={failed ? 'disabled' : 'settling'} aria-busy={!failed} style={frameStyle}>
        <div className="h-10 rounded-lg bg-[var(--bg-sunk)] opacity-70" />
        <div className="h-10 rounded-lg bg-[var(--bg-sunk)] opacity-50 mt-2" />
        <p className="text-xs text-[var(--fg-muted)] mt-3">
          {failed ? 'Las acciones personalizadas no están disponibles.' : 'Preparando acciones…'}
        </p>
      </section>
    )
  }

  if (state.ownsListing) {
    return (
      <section data-testid="pdp-viewer-state" data-state="owner" style={frameStyle}>
        <Link href={`/sell/edit/${listing.id}`} className="btn btn-dark btn-lg no-underline w-full justify-center">
          Editar este anuncio
        </Link>
      </section>
    )
  }

  const deal = state.activeDeal
  const checkoutHref = checkoutHopHref(`/checkout?listingId=${listing.id}&market=mx`, customDomain)
  const signInHref = signInHopHref(`/checkout?listingId=${listing.id}&market=mx`, customDomain)

  return (
    <section
      data-testid="pdp-viewer-state"
      data-state="ready"
      data-buyer-prefill={state.buyerPrefill ? 'available' : 'absent'}
      style={frameStyle}
    >
      <div className="flex justify-end mb-2">
        <FavoriteButton listingId={listing.id} initialFavorited={state.favorited} isSignedIn={state.signedIn} />
      </div>

      {deal?.status === 'accepted_unpaid' && deal.dealPriceCents ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-lg p-3 bg-[var(--success-soft)] text-sm font-semibold">Tu oferta fue aceptada.</div>
          <OfferCheckoutButton
            listingId={listing.id}
            offerId={deal.offerId}
            amountCents={deal.dealPriceCents}
            currency={deal.currency}
            isSignedIn={state.signedIn}
            customDomain={customDomain}
          />
        </div>
      ) : deal?.status === 'pending' || deal?.status === 'countered' ? (
        <div className="flex flex-col gap-2">
          <div className="rounded-lg p-3 bg-[var(--warning-soft)] text-sm font-semibold">
            {deal.status === 'pending' ? 'Tu oferta está pendiente.' : 'El vendedor respondió con una contraoferta.'}
          </div>
          {deal.conversationId && <Link href={`/messages/${deal.conversationId}`}>Ver conversación</Link>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {canBuy && (
            <Link
              href={state.signedIn ? checkoutHref : signInHref}
              className="flex items-center justify-center w-full font-semibold py-3 rounded-lg no-underline"
              style={{ background: 'var(--fg)', color: 'var(--fg-inverse)' }}
            >
              {state.signedIn ? `Comprar ahora — ${listing.priceLabel}` : 'Inicia sesión para comprar'}
            </Link>
          )}
          {canOffer && listing.priceCents && (
            <MakeOfferButton
              listing={{
                id: listing.id,
                title: listing.title,
                price_cents: listing.priceCents,
                currency: listing.currency,
                imageUrl: listing.imageUrl,
              }}
              buyerInfo={state.buyerPrefill ?? undefined}
              isSignedIn={state.signedIn}
              skipActiveOfferRead
            />
          )}
          <AskSellerButton listingId={listing.id} isSignedIn={state.signedIn} marketBasePath={marketBasePath} />
        </div>
      )}
    </section>
  )
}
