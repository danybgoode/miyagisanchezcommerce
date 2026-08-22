import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import PublicPdpViewerIsland from '@/app/components/PublicPdpViewerIsland'
import TrustSignals from '@/app/components/TrustSignals'
import { isShopClaimed } from '@/lib/claim'
import { getListing, getOwnedShopListing } from '@/lib/listings'
import { marketCatalogCanonical } from '@/lib/market-seo'
import { formatPresentationCurrency, resolveMarketPresentation } from '@/lib/market-presentation'
import { publicShopPaymentAvailability } from '@/lib/public-shop-commerce'

// D19: Next requires a literal. Story 2.3 proves this equals CACHE.LISTING.
export const revalidate = 60

type Props = {
  params: Promise<{
    channel: string
    identity: string
    slug: string
    id: string
  }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channel, identity, slug, id } = await params
  const listing = channel === 'subdomain'
    ? await getOwnedShopListing(slug, id)
    : await getListing(id, 'mx')
  if (!listing) return { title: 'Anuncio no encontrado' }

  const pathname = `/mx/l/${listing.id}`
  const canonical = channel === 'subdomain'
    ? `https://${identity}/l/${listing.id}`
    : `https://miyagisanchez.com${pathname}`
  return {
    title: listing.title,
    description: listing.description ?? undefined,
    ...(channel === 'marketplace' ? marketCatalogCanonical(pathname) : { alternates: { canonical } }),
    openGraph: { url: canonical },
  }
}

export default async function PublicListingPage({ params }: Props) {
  const { channel, identity, slug, id } = await params
  const listing = channel === 'subdomain'
    ? await getOwnedShopListing(slug, id)
    : await getListing(id, 'mx')
  if (!listing || listing.shop?.slug !== slug || !isShopClaimed(listing.shop)) notFound()

  const presentation = resolveMarketPresentation('mx')
  const priceLabel = listing.price_cents
    ? formatPresentationCurrency(presentation, listing.price_cents, listing.currency, { maximumFractionDigits: 0 })
    : 'Consultar precio'
  const payment = publicShopPaymentAvailability(listing.shop.metadata)
  const hasPayment = payment.stripe || payment.mercadopago || payment.bankTransfer || payment.dimo
  const canBuy = !!listing.price_cents && listing.price_cents > 0 && listing.in_stock !== false && hasPayment
  const canOffer = !!listing.price_cents && listing.price_cents > 0 && listing.listing_type === 'product'
  const shopHref = channel === 'marketplace' ? `/mx/s/${slug}` : '/'
  const customDomain = channel === 'subdomain' ? identity : null

  return (
    <div className="max-w-6xl mx-auto px-4 py-7">
      <nav className="text-sm text-[var(--fg-muted)] mb-5">
        <Link href={shopHref}>{listing.shop.name}</Link>
      </nav>
      <div className="grid md:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)] gap-8">
        <div>
          <div className="aspect-square rounded-2xl overflow-hidden bg-[var(--bg-sunk)]">
            {listing.images?.[0]?.url && (
              // eslint-disable-next-line @next/next/no-img-element -- catalog images keep their seller-hosted source.
              <img src={listing.images[0].url} alt={listing.title} className="w-full h-full object-cover" />
            )}
          </div>
          {listing.description && <p className="mt-6 whitespace-pre-wrap">{listing.description}</p>}
        </div>
        <aside>
          <h1 className="text-2xl font-bold leading-tight">{listing.title}</h1>
          <p className="text-2xl font-extrabold mt-3 mb-4">{priceLabel}</p>
          <TrustSignals
            channel={channel === 'marketplace' ? 'marketplace' : 'subdomain'}
            verified={listing.shop.verified}
            paymentProtected={payment.stripe || payment.mercadopago}
            paymentMethods={[]}
            fulfillmentMethods={[]}
            processingLabel={null}
            returnsLabel={null}
          />
          <div className="mt-5">
            <PublicPdpViewerIsland
              listing={{
                id: listing.id,
                title: listing.title,
                priceCents: listing.price_cents,
                priceLabel,
                currency: listing.currency,
                imageUrl: listing.images?.[0]?.url ?? null,
              }}
              shopSlug={slug}
              marketBasePath="/mx"
              customDomain={customDomain}
              canBuy={canBuy}
              canOffer={canOffer}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
