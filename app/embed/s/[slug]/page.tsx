/**
 * GET /embed/s/[slug] — full-shop EMBED surface (07 · Embeddable Widget, US-5).
 *
 * A seller drops their whole storefront onto another site with an <iframe>:
 *
 *   <iframe src="https://miyagisanchez.com/embed/s/<slug>?key=emb_pk_…"
 *           style="width:100%;height:760px;border:0"></iframe>
 *
 * It reuses the white-label `ChannelLayout` (branded, no platform chrome — the
 * root layout suppresses its header/footer when middleware tags the request as
 * an embed surface). The page is served `Content-Security-Policy: frame-ancestors *`
 * (next.config) so any site can frame it.
 *
 * Buy hands off to OUR hosted flow: each card opens `/l/<id>?channel=embed` in a
 * NEW TOP-LEVEL TAB (target="_blank"). Clerk auth can't run inside a cross-origin
 * iframe (third-party cookies), so checkout MUST break out to our own origin —
 * where the Sprint 1 cookie tags the sale `channel=embed`. No commerce logic here.
 */

import { notFound } from 'next/navigation'
import { getShop, getShopListings, formatPrice } from '@/lib/listings'
import ChannelLayout from '@/app/s/[slug]/ChannelLayout'
import type { Metadata } from 'next'

export const revalidate = 120

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) return { title: 'Tienda no encontrada' }
  return {
    title: shop.name,
    // An embed should never compete with the host page in search results.
    robots: { index: false, follow: false },
  }
}

export default async function EmbedShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ key?: string }>
}) {
  const { slug } = await params
  const { key } = await searchParams
  const shop = await getShop(slug)
  if (!shop) notFound()
  const listings = await getShopListings(shop.slug)

  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as { accent_color?: string | null; tagline?: string | null }
  const accent = theme.accent_color ?? '#1d6f42'

  // Buy breaks out of the iframe to our own origin (Clerk can't run framed).
  // Carry the embed key through for attribution where present.
  const listingHref = (id: string) =>
    `/l/${id}?channel=embed${key ? `&ref_key=${encodeURIComponent(key)}` : ''}`

  return (
    <ChannelLayout shopName={shop.name} accentColor={accent} logoUrl={shop.logo_url ?? null} domain="">
      <div style={{ '--shop-accent': accent } as React.CSSProperties}>
        <div className="max-w-6xl mx-auto px-4 py-6">
          {/* Shop heading */}
          <div className="mb-5">
            <h1 className="text-lg font-bold leading-tight" style={{ color: '#111' }}>{shop.name}</h1>
            {theme.tagline && <p className="text-sm text-[#666] mt-0.5 italic">&ldquo;{theme.tagline}&rdquo;</p>}
            <p className="text-xs text-[#888] mt-1">{listings.length} anuncios</p>
          </div>

          {listings.length === 0 ? (
            <div className="text-center py-16 text-[#888]">
              <div className="text-4xl mb-3">📦</div>
              <p className="font-medium">Esta tienda aún no tiene anuncios.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {listings.map(listing => {
                const img = listing.images?.[0]?.url ?? null
                return (
                  <a
                    key={listing.id}
                    href={listingHref(listing.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl overflow-hidden border border-black/10 bg-white no-underline hover:shadow-md transition-shadow"
                  >
                    <div className="aspect-square bg-[#f3f4f6] flex items-center justify-center overflow-hidden">
                      {img
                        ? <img src={img} alt={listing.title} className="w-full h-full object-cover" />
                        : <span className="text-3xl text-[#c0c4c8]">🏪</span>}
                    </div>
                    <div className="p-2.5">
                      <p className="text-[13px] font-semibold text-[#111] line-clamp-2 leading-snug">{listing.title}</p>
                      <p className="text-[15px] font-extrabold mt-1" style={{ color: '#111' }}>{formatPrice(listing)}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ChannelLayout>
  )
}
