import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMarketplaceShopListings, getShop, getShopListings, formatPrice } from '@/lib/listings'
import { marketCatalogCanonical } from '@/lib/market-seo'

// D19: Next requires a literal. Story 2.3 proves this equals CACHE.SHOP.
export const revalidate = 120

type Props = {
  params: Promise<{
    channel: string
    identity: string
    slug: string
    rest?: string[]
  }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { channel, identity, slug, rest = [] } = await params
  const shop = await getShop(slug, channel === 'marketplace' ? 'mx' : undefined)
  if (!shop) return { title: 'Tienda no encontrada' }
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as { tagline?: string | null; banner_url?: string | null }

  if (channel === 'embed') {
    return { title: shop.name, robots: { index: false, follow: false } }
  }

  const pathname = channel === 'marketplace'
    ? `/mx/s/${slug}${rest.length ? `/${rest.join('/')}` : ''}`
    : `/${rest.join('/')}`
  const canonical = channel === 'subdomain'
    ? `https://${identity}${pathname === '/' ? '/' : pathname}`
    : `https://miyagisanchez.com${pathname}`

  if (channel === 'marketplace' && rest.length > 0) {
    const section = rest[0]
    if (section === 'acerca') {
      return { title: `Acerca — ${shop.name}`, ...marketCatalogCanonical(pathname) }
    }
    if (section === 'faq') {
      return { title: `Preguntas frecuentes — ${shop.name}`, ...marketCatalogCanonical(pathname) }
    }
    if (section === 'politicas') {
      return { title: `Políticas — ${shop.name}`, ...marketCatalogCanonical(pathname) }
    }
    // The shipped collections/events/shop section wrappers emit only this title.
    return { title: shop.name }
  }

  return {
    title: shop.name,
    description: theme.tagline ?? shop.description ?? undefined,
    ...(channel === 'marketplace' ? marketCatalogCanonical(pathname) : { alternates: { canonical } }),
    openGraph: {
      url: canonical,
      images: theme.banner_url ? [{ url: theme.banner_url }] : undefined,
    },
  }
}

export default async function PublicShopPage({ params }: Props) {
  const { channel, slug, rest = [] } = await params
  const shop = await getShop(slug, channel === 'marketplace' ? 'mx' : undefined)
  if (!shop) notFound()

  const listingRead = channel === 'marketplace'
    ? await getMarketplaceShopListings(shop.slug, 'mx')
    : { listings: await getShopListings(shop.slug), market_unavailable: null }
  if (listingRead.market_unavailable) notFound()
  const listings = listingRead.listings
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as {
    accent_color?: string | null
    tagline?: string | null
    banner_url?: string | null
  }
  const accent = theme.accent_color ?? 'var(--color-accent)'
  const listingHref = (id: string) => channel === 'subdomain'
    ? `/l/${id}`
    : channel === 'embed'
      ? `/mx/l/${id}?channel=embed`
      : `/mx/l/${id}`

  return (
    <div style={{ '--shop-accent': accent } as React.CSSProperties}>
      <section className="max-w-6xl mx-auto px-4 py-8">
        {theme.banner_url && (
          // eslint-disable-next-line @next/next/no-img-element -- seller-hosted shop art keeps its source URL.
          <img src={theme.banner_url} alt="" className="w-full h-48 object-cover rounded-2xl mb-6" />
        )}
        <div className="flex items-center gap-4 mb-7">
          {shop.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- seller-hosted logos keep their source URL.
            <img src={shop.logo_url} alt="" className="w-16 h-16 rounded-full object-cover border" />
          )}
          <div>
            <h1 className="text-2xl font-bold">{shop.name}</h1>
            {theme.tagline && <p className="text-sm text-[var(--fg-muted)] mt-1">{theme.tagline}</p>}
          </div>
        </div>

        {rest.length > 0 && (
          <nav className="mb-6 text-sm">
            <Link href={channel === 'marketplace' ? `/mx/s/${slug}` : '/'}>← {shop.name}</Link>
            <h2 className="text-xl font-semibold mt-4 capitalize">{rest.join(' · ').replaceAll('-', ' ')}</h2>
          </nav>
        )}

        <p className="text-sm text-[var(--fg-muted)] mb-4">{listings.length} anuncios</p>
        {listings.length === 0 ? (
          <div className="py-16 text-center text-[var(--fg-subtle)]">Esta tienda aún no tiene anuncios.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {listings.map((listing) => (
              <Link key={listing.id} href={listingHref(listing.id)} className="block rounded-xl overflow-hidden border bg-white no-underline">
                <div className="aspect-square bg-[var(--bg-sunk)] overflow-hidden">
                  {listing.images?.[0]?.url && (
                    // eslint-disable-next-line @next/next/no-img-element -- catalog images keep their seller-hosted source.
                    <img src={listing.images[0].url} alt={listing.title} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-semibold line-clamp-2">{listing.title}</p>
                  <p className="font-bold mt-1">{formatPrice(listing)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
