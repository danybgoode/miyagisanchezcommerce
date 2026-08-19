import { BuyerCopyText } from '@/app/components/BuyerPresentationContext'
import { notFound, permanentRedirect } from 'next/navigation'
import { headers } from 'next/headers'
import {
  getShop,
  getShopListings,
  getMarketplaceShopListings,
  getShopCollections,
  formatPrice,
} from '@/lib/listings'
import { isShopPreviewPrivateBySlug } from '@/lib/preview-access'
import { hasExcerpt } from '@/lib/excerpt'
import { isLikelyShopSlug } from '@/lib/route-shape'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import { getSlugRedirect } from '@/lib/slug-redirect'
import { SetAgentContext } from '@/app/components/AgentContext'
import ClaimButton from './ClaimButton'
import ClosetListingCard from './ClosetListingCard'
import AnnouncementBar from './AnnouncementBar'
import HeroSection from './HeroSection'
import ShopSectionNav from '@/app/(shell)/_shop-sections/ShopSectionNav'
import WallFeed from '@/app/(shell)/_wall/WallFeed'
import { readableTextOn } from '@/lib/platform-theme'
import { publicShopPaymentAvailability } from '@/lib/public-shop-commerce'
import type { AnnouncementSettings, HeroSettings } from '@/lib/shop-settings/types'
import type { Metadata } from 'next'
import type { MarketCode } from '@/lib/markets'
import { marketCatalogCanonical } from '@/lib/market-seo'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { getDictionary } from '@/lib/dictionary'
import { resolveMarketPresentation } from '@/lib/market-presentation'
import { readPublicWall } from '@/lib/wall/public'
import { resolvePublicWallShop } from '@/lib/wall/store'
import { normalizeSections } from '@/lib/shop-presentation/sections'
import { resolveSectionAvailability } from '@/lib/shop-presentation/availability'
import { resolveTheme } from '@/lib/shop-presentation/theme'
import { applyPreviewOverlay } from '@/lib/shop-presentation/preview'

export const revalidate = 120   // re-render shop page at most every 2 minutes

interface Social { instagram?: string; facebook?: string; whatsapp?: string; tiktok?: string; twitter?: string }

export async function generateShopMetadata({
  params,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string }>
  market?: MarketCode
  marketBasePath?: string
}): Promise<Metadata> {
  const { slug } = await params
  const requestHeaders = await headers()
  if (!isLikelyShopSlug(slug)) return { title: 'Tienda no encontrada' }
  const shop = await getShop(slug, market)
  if (!shop) return { title: 'Tienda no encontrada' }
  if (market && readPublicSellerMarket(shop)?.market_code !== market) {
    return { title: 'Tienda no encontrada' }
  }
  // Don't leak a preview-private shop's name/description in metadata (S1.2 guard).
  if (await isShopPreviewPrivateBySlug(shop.slug, shop.clerk_user_id)) return { title: 'Tienda no encontrada' }
  const theme = (shop.metadata as Record<string, unknown> | null)?.settings as Record<string, unknown> | undefined
  const t = (theme?.theme ?? {}) as Record<string, unknown>
  if (marketBasePath) {
    const pathname = `${marketBasePath}/s/${slug}`
    return {
      title: shop.name,
      description: (t.tagline as string | undefined) ?? shop.description ?? undefined,
      ...marketCatalogCanonical(pathname),
      openGraph: {
        url: `https://miyagisanchez.com${pathname}`,
        images: (t.banner_url as string | undefined) ? [{ url: t.banner_url as string }] : undefined,
      },
    }
  }
  // Canonical points at the shop's own domain when live, so search engines
  // consolidate ranking on the brand domain instead of the marketplace mirror.
  const requestDomain = requestHeaders.get('x-miyagi-domain')
  const domain = requestDomain ?? await getActiveCustomDomain(slug)
  const canonical = domain ? `https://${domain}/` : `https://miyagisanchez.com/mx/s/${slug}`
  return {
    title: shop.name,
    description: (t.tagline as string | undefined) ?? shop.description ?? undefined,
    alternates: { canonical },
    openGraph: {
      url: canonical,
      images: (t.banner_url as string | undefined) ? [{ url: t.banner_url as string }] : undefined,
    },
  }
}

export const generateMetadata = generateShopMetadata

// ── Shop page ─────────────────────────────────────────────────────────────────

export async function ShopPage({
  params,
  searchParams,
  market,
  marketBasePath = '',
}: {
  params: Promise<{ slug: string }>
  /** Carries the studio's owner-only preview draft (Story 5.5). Absent everywhere else. */
  searchParams?: Promise<Record<string, string | string[] | undefined>>
  market?: MarketCode
  marketBasePath?: string
}) {
  const { slug } = await params
  // Short-circuit junk URLs BEFORE any Medusa fetch (epic 09 · cost reduction
  // S2.2): a clearly-malformed slug can be neither a live nor a retired shop
  // (retired slugs obey the same format), so 404 it without a Store API call or a
  // redirect lookup. A well-formed-but-deleted slug passes here and 404s / 301s
  // cleanly below. On platform hosts middleware 404s these (with a cache header)
  // before the function is invoked; this guard is defense-in-depth.
  if (!isLikelyShopSlug(slug)) notFound()
  const shop = await getShop(slug, market)
  if (!shop) {
    // The shop may have been renamed — 301 a retired slug to its current one for
    // 90 days so old links/business cards keep working (US-4).
    const current = await getSlugRedirect(slug)
    if (current) permanentRedirect(`${marketBasePath}/s/${current}`)
    notFound()
  }
  if (market && readPublicSellerMarket(shop)?.market_code !== market) notFound()
  const presentationMarket = market ?? readPublicSellerMarket(shop)?.market_code ?? 'mx'
  const buyerCopy = (await getDictionary(resolveMarketPresentation(presentationMarket).language)).buyerCopy

  // Consent-safe preview leak guard (founding-merchant-consent-previews S1.2): a
  // shop with a non-activated preview anchor is private across every public
  // channel — this /s/[slug] path is also the rewrite target for the custom-domain
  // and subdomain channels, so one 404 here covers all three. Products are already
  // draft-private structurally; this additionally hides the empty shop shell +
  // merchant name until the promoter activates the approved snapshot (Sprint 2).
  if (await isShopPreviewPrivateBySlug(shop.slug, shop.clerk_user_id)) notFound()

  // SEO continuity: if this shop has a LIVE custom domain and we're being viewed
  // on the marketplace host (not already on that domain), 308-redirect legacy
  // /s/[slug] traffic to the tenant's own home so links + ranking move with them.
  const reqHeaders = await headers()
  const onChannel = reqHeaders.get('x-miyagi-channel') === 'custom'
  if (!onChannel && !marketBasePath) {
    const domain = await getActiveCustomDomain(shop.slug)
    if (domain) permanentRedirect(`https://${domain}/`)
  }
  // Collection nav-strip hrefs: rooted (`''`) on ANY channel (subdomain or
  // custom domain — both already serve `/c/...` at the domain root), the
  // full `/s/[slug]/c/...` prefix only on the marketplace host.
  const channelValue = reqHeaders.get('x-miyagi-channel')
  const navBasePath = (channelValue === 'custom' || channelValue === 'subdomain')
    ? ''
    : `${marketBasePath}/s/${shop.slug}`

  // The Wall's shop is the SUPABASE mirror row, not the Medusa seller `shop`
  // above — their ids live in different systems and only the slug is shared.
  // A seller with no mirror row yet simply has no Wall (known-absent).
  const [listingRead, allCollections, wallShop] = await Promise.all([
    market
      ? getMarketplaceShopListings(shop.slug, market)
      : getShopListings(shop.slug).then((listings) => ({
          listings,
          market_code: null,
          market_unavailable: null,
        })),
    getShopCollections(shop.slug, market),
    resolvePublicWallShop(shop.slug),
  ])
  const wall = wallShop
    ? await readPublicWall({
        shopId: wallShop.id,
        shopSlug: wallShop.slug,
        basePath: navBasePath,
        locale: resolveMarketPresentation(presentationMarket).htmlLang,
      })
    : { entries: [], hasMore: false, total: 0 }

  // A refused/mismatched catalog is unavailable, not an empty successful shop.
  // Rendering the latter would cache and index a confident falsehood.
  if (listingRead.market_unavailable) notFound()
  const listings = listingRead.listings
  const publishedCollectionHandles = new Set(listings.flatMap((listing) => listing.collections ?? []))
  const collections = market
    ? allCollections.filter((collection) => publishedCollectionHandles.has(collection.handle))
    : allCollections

  // Extract theme from metadata.
  //
  // The studio's Vista previa renders THIS page in an iframe with its pending
  // draft in the query string, so the preview and the public shop are one
  // renderer (Story 5.5). `applyPreviewOverlay` returns the settings untouched
  // unless the Clerk session owns THIS shop — so unsaved state cannot leak to a
  // visitor, a crawler, or even to another signed-in merchant.
  const persistedSettings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const settings = await applyPreviewOverlay(shop.slug, persistedSettings, (await searchParams) ?? {})
  const theme = (settings.theme ?? {}) as {
    banner_url?: string | null
    accent_color?: string | null
    tagline?: string | null
    social?: Social
  }
  const checkout = (settings.checkout ?? {}) as {
    show_phone?: boolean
    phone?: string | null
    whatsapp_cta?: boolean
    show_email?: boolean
    contact_email?: string | null
  }
  const shipping = (settings.shipping ?? {}) as {
    local_pickup?: boolean
    pickup_spots?: Array<{ name?: string; address?: string }>
  }
  const scheduling = (settings.scheduling ?? {}) as { links?: Array<{ label?: string; url?: string }> }
  const calcom = (settings.calcom ?? {}) as { connected?: boolean; booking_url?: string; event_type_title?: string }
  const returnsPolicy = settings.returns_policy as { window?: string } | null | undefined
  // Own-shop premium presentation (epic 07, Sprint 1) — absent keys render today's storefront.
  const announcement = settings.announcement as AnnouncementSettings | null | undefined
  const hero = settings.hero as HeroSettings | null | undefined
  // Theme engine v2 (Story 4.1). The resolver decides the attribute AND whether
  // the legacy preset attribute still applies — a shop that never chose a mode
  // keeps painting exactly what it painted yesterday (epic D5).
  const shopTheme = resolveTheme(settings)
  // Own-shop premium presentation (epic 07, Sprint 3) — content-page footer
  // links. Unauthored pages are simply omitted (never a dead link).
  // The controlled information architecture (Story 3.1/3.2). Config is what the
  // seller wants; availability is what the data supports. A nav link renders only
  // where the two agree, which is what makes a hidden section and an empty one
  // both produce no link rather than a dead one.
  const sectionConfig = normalizeSections(settings.sections)
  const sectionAvailability = await resolveSectionAvailability({
    shopId: wallShop?.id ?? null,
    settings,
    collectionCount: collections.length,
  })

  const paymentAvailability = publicShopPaymentAvailability(shop.metadata)
  const sellerHasStripe = paymentAvailability.stripe
  const sellerHasMp = paymentAvailability.mercadopago
  const hasBankTransfer = paymentAvailability.bankTransfer
  const hasDimo = paymentAvailability.dimo
  const hasPickup = !!shipping.local_pickup
  const hasScheduling = !!(calcom.connected && calcom.booking_url) || !!scheduling.links?.some(link => link.url)
  const returnsLabel = returnsPolicy?.window === '7d' ? buyerCopy['listing.returnWindow7']
    : returnsPolicy?.window === '14d' ? buyerCopy['listing.returnWindow14']
    : returnsPolicy?.window === '30d' ? buyerCopy['listing.returnWindow30']
    : null
  const visibleWhatsapp = checkout.whatsapp_cta ? (theme.social?.whatsapp ?? checkout.phone ?? null) : null
  const visiblePhone = checkout.show_phone ? checkout.phone ?? null : null

  const accent = theme.accent_color ?? 'var(--color-accent)'
  const hasBanner = !!theme.banner_url
  // Readable text over the seller's own accent — a light/pastel accent needs
  // dark ink instead of hardcoded white (reused by the announcement bar + the
  // hero promo CTA button, both painted with `accent` as their background).
  const accentTextColor = readableTextOn(theme.accent_color ?? undefined)

  const pageContent = (
    <div
      style={{ '--shop-accent': accent, ...shopTheme.variables } as React.CSSProperties}
      data-shop-surface={shopTheme.recipe.surface}
      data-shop-background={shopTheme.recipe.background}
      data-shop-wall={shopTheme.recipe.wall_layout}
      data-shop-identity={shopTheme.recipe.identity}
      data-shop-preset={shopTheme.presetAttribute || undefined}
    >

      {/* Push the shop name into AgentContext so the navbar AI card's copied prompt names
          this shop (S2.2). On white-label channels the AIAgentButton consumer isn't
          rendered, so the value is set but never read → harmless. */}
      <SetAgentContext shopName={shop.name} />

      {/* ── Announcement bar (own-shop premium presentation, Sprint 1) ──────── */}
      <AnnouncementBar announcement={announcement} textColor={accentTextColor} />

      {/* ── Banner + shop identity header ───────────────────────────────────── */}
      <div className="relative mb-16">
        {/* Banner */}
        <div
          className="w-full h-40 sm:h-52"
          style={hasBanner
            ? { backgroundImage: `url(${theme.banner_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : { backgroundColor: accent }
          }
        />

        {/* Logo + info (overlapping banner) */}
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-end gap-4 -mt-10 relative z-10">
            {/* Logo */}
            <div
              className="w-20 h-20 rounded-full border-4 border-white shadow-md bg-white flex items-center justify-center text-3xl flex-shrink-0 overflow-hidden"
            >
              {shop.logo_url ? (
                // Remote seller logos are not constrained to a Next Image allow-list.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shop.logo_url} alt={shop.name} className="w-full h-full object-cover" />
              ) : (
                <i className="iconoir-shop" aria-hidden />
              )}
            </div>

            {/* Name, tagline, social */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold leading-tight">{shop.name}</h1>
                {shop.verified && (
                  <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1" style={{ backgroundColor: accent }}>
                    <i className="iconoir-badge-check" aria-hidden /> <BuyerCopyText copyKey="s.slug.page.b71696d5" /></span>
                )}
                {!shop.clerk_user_id && (
                  <span className="text-xs border border-amber-300 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full"><BuyerCopyText copyKey="s.slug.page.ef1e1e62" /></span>
                )}
              </div>
              {theme.tagline && (
                <p className="text-sm text-[var(--color-muted)] mt-0.5 italic">&ldquo;{theme.tagline}&rdquo;</p>
              )}
              {shop.location && (
                <p className="text-xs text-[var(--color-muted)] mt-0.5"><i className="iconoir-map-pin" aria-hidden /> {shop.location}</p>
              )}
            </div>

            {/* Listing count (top-right) */}
            <div className="hidden sm:block text-right pb-1 flex-shrink-0">
              <span className="text-sm font-semibold">{listings.length}</span>
              <span className="text-xs text-[var(--color-muted)] ml-1"><BuyerCopyText copyKey="s.slug.page.7789bbbe" /></span>
            </div>
          </div>

          {/* Description + social on its own row */}
          {(shop.description || theme.social || visiblePhone || checkout.show_email) && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              {shop.description && (
                <p className="text-sm text-[var(--color-muted)] max-w-xl">{shop.description}</p>
              )}
              {(theme.social && Object.values(theme.social).some(Boolean)) || visiblePhone || checkout.show_email ? (
                <div className="flex items-center gap-2 flex-wrap">
                  {theme.social?.instagram && (
                    <a href={`https://instagram.com/${theme.social.instagram}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-text)] transition-colors no-underline">
                      <i className="iconoir-camera" aria-hidden /><span>@{theme.social.instagram}</span>
                    </a>
                  )}
                  {theme.social?.tiktok && (
                    <a href={`https://tiktok.com/@${theme.social.tiktok}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-text)] transition-colors no-underline">
                      <i className="iconoir-music-note" aria-hidden /><span>@{theme.social.tiktok}</span>
                    </a>
                  )}
                  {visibleWhatsapp && (
                    <a href={`https://wa.me/${visibleWhatsapp}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors no-underline">
                      <i className="iconoir-chat-bubble" aria-hidden /><span><BuyerCopyText copyKey="s.slug.page.75ff89ed" /></span>
                    </a>
                  )}
                  {visiblePhone && (
                    <a href={`tel:${visiblePhone}`} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <i className="iconoir-phone" aria-hidden /><span><BuyerCopyText copyKey="s.slug.page.2933e939" /></span>
                    </a>
                  )}
                  {checkout.show_email && checkout.contact_email && (
                    <a href={`mailto:${checkout.contact_email}`} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <i className="iconoir-mail" aria-hidden /><span><BuyerCopyText copyKey="s.slug.page.9cb8b4c7" /></span>
                    </a>
                  )}
                  {theme.social?.facebook && (
                    <a href={theme.social.facebook} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <i className="iconoir-community" aria-hidden /><span><BuyerCopyText copyKey="s.slug.page.f8cccf3d" /></span>
                    </a>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Claim CTA for unowned shops */}
          {!shop.clerk_user_id && (
            <div className="mt-3">
              <ClaimButton href={`${marketBasePath}/s/${slug}/claim`} accent={accent} />
            </div>
          )}
        </div>
      </div>

      {/* ── Hero/featured section (own-shop premium presentation, Sprint 1) ──── */}
      <HeroSection
        hero={hero}
        listings={listings}
        shop={shop}
        accent={accent}
        textColor={accentTextColor}
        sellerHasStripe={sellerHasStripe}
        sellerHasMp={sellerHasMp}
        hasBankTransfer={hasBankTransfer}
        marketBasePath={marketBasePath}
      />

      {/* ── The ONE shop nav (Living Shop, epic 07 · Story 3.2) ───────────────
          This REPLACES the collection strip that used to sit here. Two nav bars
          on one storefront is the outcome Story 3.2 forbids by name, and the
          chips were never navigation — they are a filter, so they moved to the
          destinations where that is what they do (/tienda and /colecciones). */}
      <ShopSectionNav
        config={sectionConfig}
        availability={sectionAvailability}
        basePath={navBasePath}
        active="wall"
        accent={accent}
        activeTextColor={accentTextColor}
        copy={buyerCopy}
      />

      {/* ── The Wall (Living Shop, epic 07 · Sprint 2) ────────────────────────
          Rendered only when the merchant has actually published something. A
          shop with a catalog and an empty Wall keeps today's storefront exactly
          as it is — an empty-feed box above a full product grid would be noise,
          and S2.5 asks that a shop with no new settings degrade to the new
          Default WITHOUT losing content. WallFeed's designed empty state belongs
          to the dedicated Wall destination, where the feed is the whole page. */}
      {wall.total > 0 && (
        <WallFeed
          entries={wall.entries}
          hasMore={wall.hasMore}
          shopSlug={shop.slug}
          emptyShopHref={`${navBasePath}/tienda`}
          ctx={{
            copy: buyerCopy,
            basePath: navBasePath,
            htmlLang: resolveMarketPresentation(presentationMarket).htmlLang,
          }}
        />
      )}

      {/* ── Listings grid ────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
        {(sellerHasMp || sellerHasStripe || hasBankTransfer || hasDimo || hasPickup || hasScheduling || returnsLabel) && (
          <div className="flex flex-wrap gap-2 mb-5">
            {sellerHasMp && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]"><BuyerCopyText copyKey="s.slug.page.85cbb14f" /></span>}
            {sellerHasStripe && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]"><BuyerCopyText copyKey="s.slug.page.15146f83" /></span>}
            {hasBankTransfer && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]"><BuyerCopyText copyKey="s.slug.page.9bc19390" /></span>}
            {hasDimo && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]"><BuyerCopyText copyKey="s.slug.page.4df902a1" /></span>}
            {hasPickup && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]"><BuyerCopyText copyKey="s.slug.page.ad1b2858" />{shipping.pickup_spots?.[0]?.name ? `: ${shipping.pickup_spots[0].name}` : ''}</span>}
            {hasScheduling && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">{calcom.event_type_title ?? scheduling.links?.[0]?.label ?? <BuyerCopyText copyKey="s.slug.page.a762f91d" />}</span>}
            {returnsLabel && <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700"><BuyerCopyText copyKey="s.slug.page.b4c1603f" />{' '}{returnsLabel}</span>}
          </div>
        )}
        {listings.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-muted)]">
            <div className="text-4xl mb-3"><i className="iconoir-package" aria-hidden /></div>
            <p className="font-medium"><BuyerCopyText copyKey="s.slug.page.f62ef63c" /></p>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--color-muted)] mb-3 sm:hidden">{listings.length} <BuyerCopyText copyKey="s.slug.page.7789bbbe" /></p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {listings.map(listing => (
                <ClosetListingCard
                  key={listing.id}
                  accent={accent}
                  item={{
                    productId: listing.id,
                    variantId: null,
                    sellerId: shop.id ?? '',
                    sellerSlug: shop.slug,
                    sellerName: shop.name,
                    title: listing.title,
                    price_cents: listing.price_cents ?? 0,
                    currency: listing.currency ?? 'MXN',
                    imageUrl: listing.images?.[0]?.url ?? null,
                    listing_type: listing.listing_type ?? 'product',
                    paymentMethods: { stripe: sellerHasStripe, mp: sellerHasMp, spei: hasBankTransfer },
                    href: `${marketBasePath}/l/${listing.id}`,
                    formattedPrice: formatPrice(listing, resolveMarketPresentation(presentationMarket).htmlLang),
                    status: listing.status,
                    hasExcerpt: hasExcerpt(listing.metadata),
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* The footer content links that used to sit here are GONE (Living Shop,
          epic 07 · Story 3.5). Acerca / Preguntas / Políticas are now first-class
          nav destinations, and keeping the footer copy would have reintroduced
          exactly the problem the section nav solves — plus it ignored the
          seller's hidden-section choice, so a page they had deliberately taken
          out of the nav stayed reachable from the bottom of the page.
          `ShopContentLinks.tsx` itself is untouched and still serves the
          collection pages that render it. */}
    </div>
  )

  // On a custom domain the root layout already wraps every page in the shop's
  // white-label shell (ChannelLayout), so the page just returns its content.
  return pageContent
}

export default ShopPage
