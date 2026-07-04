import { notFound, permanentRedirect } from 'next/navigation'
import { headers } from 'next/headers'
import Link from 'next/link'
import { getShop, getShopListings, formatPrice } from '@/lib/listings'
import { isLikelyShopSlug } from '@/lib/route-shape'
import { getActiveCustomDomain } from '@/lib/custom-domain'
import { getSlugRedirect } from '@/lib/slug-redirect'
import { SetAgentContext } from '@/app/components/AgentContext'
import ClaimButton from './ClaimButton'
import ClosetListingCard from './ClosetListingCard'
import AnnouncementBar from './AnnouncementBar'
import HeroSection from './HeroSection'
import type { AnnouncementSettings, HeroSettings } from '@/lib/shop-settings/types'
import type { Metadata } from 'next'

export const revalidate = 120   // re-render shop page at most every 2 minutes

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  if (!isLikelyShopSlug(slug)) return { title: 'Tienda no encontrada' }
  const shop = await getShop(slug)
  if (!shop) return { title: 'Tienda no encontrada' }
  const theme = (shop.metadata as Record<string, unknown> | null)?.settings as Record<string, unknown> | undefined
  const t = (theme?.theme ?? {}) as Record<string, unknown>
  // Canonical points at the shop's own domain when live, so search engines
  // consolidate ranking on the brand domain instead of the marketplace mirror.
  const domain = await getActiveCustomDomain(slug)
  const canonical = domain ? `https://${domain}/` : `https://miyagisanchez.com/s/${slug}`
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

// ── Social link helpers ────────────────────────────────────────────────────────

interface Social { instagram?: string; facebook?: string; whatsapp?: string; tiktok?: string; twitter?: string }

function SocialLinks({ social }: { social: Social }) {
  const links = [
    social.instagram && { href: `https://instagram.com/${social.instagram}`, label: 'Instagram', icon: '📸' },
    social.tiktok    && { href: `https://tiktok.com/@${social.tiktok}`,     label: 'TikTok',    icon: '🎵' },
    social.facebook  && { href: social.facebook,                              label: 'Facebook',  icon: '👥' },
    social.whatsapp  && { href: `https://wa.me/${social.whatsapp}`,           label: 'WhatsApp',  icon: '💬' },
  ].filter(Boolean) as { href: string; label: string; icon: string }[]

  if (links.length === 0) return null

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {links.map(l => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={l.label}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-white/30 text-white/90 hover:bg-white/20 transition-colors no-underline"
        >
          <span>{l.icon}</span>
          <span>{l.label}</span>
        </a>
      ))}
    </div>
  )
}

// ── Shop page ─────────────────────────────────────────────────────────────────

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Short-circuit junk URLs BEFORE any Medusa fetch (epic 09 · cost reduction
  // S2.2): a clearly-malformed slug can be neither a live nor a retired shop
  // (retired slugs obey the same format), so 404 it without a Store API call or a
  // redirect lookup. A well-formed-but-deleted slug passes here and 404s / 301s
  // cleanly below. On platform hosts middleware 404s these (with a cache header)
  // before the function is invoked; this guard is defense-in-depth.
  if (!isLikelyShopSlug(slug)) notFound()
  const shop = await getShop(slug)
  if (!shop) {
    // The shop may have been renamed — 301 a retired slug to its current one for
    // 90 days so old links/business cards keep working (US-4).
    const current = await getSlugRedirect(slug)
    if (current) permanentRedirect(`/s/${current}`)
    notFound()
  }

  // SEO continuity: if this shop has a LIVE custom domain and we're being viewed
  // on the marketplace host (not already on that domain), 308-redirect legacy
  // /s/[slug] traffic to the tenant's own home so links + ranking move with them.
  const onChannel = (await headers()).get('x-miyagi-channel') === 'custom'
  if (!onChannel) {
    const domain = await getActiveCustomDomain(shop.slug)
    if (domain) permanentRedirect(`https://${domain}/`)
  }

  const listings = await getShopListings(shop.slug)

  // Extract theme from metadata
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
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
  const stripe = (settings.stripe ?? {}) as { enabled?: boolean; charges_enabled?: boolean; account_id?: string }
  // Own-shop premium presentation (epic 07, Sprint 1) — absent keys render today's storefront.
  const announcement = settings.announcement as AnnouncementSettings | null | undefined
  const hero = settings.hero as HeroSettings | null | undefined
  const themePreset = settings.theme_preset as string | null | undefined
  const mpEnabled = ((shop.metadata as Record<string, unknown> | null)?.mp_enabled as boolean | undefined) !== false
  const sellerHasStripe = !!(stripe.enabled !== false && stripe.charges_enabled && stripe.account_id)
  const checkoutSett = (settings.checkout ?? {}) as { bank_transfer?: { clabe?: string | null } }
  const hasClabe = !!(checkoutSett.bank_transfer?.clabe?.trim() && checkoutSett.bank_transfer.clabe.trim().length === 18)
  const hasPickup = !!shipping.local_pickup
  const hasScheduling = !!(calcom.connected && calcom.booking_url) || !!scheduling.links?.some(link => link.url)
  const returnsLabel = returnsPolicy?.window === '7d' ? '7 días'
    : returnsPolicy?.window === '14d' ? '14 días'
    : returnsPolicy?.window === '30d' ? '30 días'
    : null
  const visibleWhatsapp = checkout.whatsapp_cta ? (theme.social?.whatsapp ?? checkout.phone ?? null) : null
  const visiblePhone = checkout.show_phone ? checkout.phone ?? null : null

  const accent = theme.accent_color ?? 'var(--color-accent)'
  const hasBanner = !!theme.banner_url

  const pageContent = (
    <div
      style={{ '--shop-accent': accent } as React.CSSProperties}
      data-shop-preset={themePreset || undefined}
    >

      {/* Push the shop name into AgentContext so the navbar AI card's copied prompt names
          this shop (S2.2). On white-label channels the AIAgentButton consumer isn't
          rendered, so the value is set but never read → harmless. */}
      <SetAgentContext shopName={shop.name} />

      {/* ── Announcement bar (own-shop premium presentation, Sprint 1) ──────── */}
      <AnnouncementBar announcement={announcement} />

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
                <img src={shop.logo_url} alt={shop.name} className="w-full h-full object-cover" />
              ) : (
                <span>🏪</span>
              )}
            </div>

            {/* Name, tagline, social */}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold leading-tight">{shop.name}</h1>
                {shop.verified && (
                  <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium inline-flex items-center gap-1" style={{ backgroundColor: accent }}>
                    <i className="iconoir-badge-check" aria-hidden /> Verificado
                  </span>
                )}
                {!shop.clerk_user_id && (
                  <span className="text-xs border border-amber-300 text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Sin reclamar</span>
                )}
              </div>
              {theme.tagline && (
                <p className="text-sm text-[var(--color-muted)] mt-0.5 italic">"{theme.tagline}"</p>
              )}
              {shop.location && (
                <p className="text-xs text-[var(--color-muted)] mt-0.5">📍 {shop.location}</p>
              )}
            </div>

            {/* Listing count (top-right) */}
            <div className="hidden sm:block text-right pb-1 flex-shrink-0">
              <span className="text-sm font-semibold">{listings.length}</span>
              <span className="text-xs text-[var(--color-muted)] ml-1">anuncios</span>
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
                      <span>📸</span><span>@{theme.social.instagram}</span>
                    </a>
                  )}
                  {theme.social?.tiktok && (
                    <a href={`https://tiktok.com/@${theme.social.tiktok}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-text)] transition-colors no-underline">
                      <span>🎵</span><span>@{theme.social.tiktok}</span>
                    </a>
                  )}
                  {visibleWhatsapp && (
                    <a href={`https://wa.me/${visibleWhatsapp}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors no-underline">
                      <span>💬</span><span>WhatsApp</span>
                    </a>
                  )}
                  {visiblePhone && (
                    <a href={`tel:${visiblePhone}`} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <span>☎</span><span>Teléfono</span>
                    </a>
                  )}
                  {checkout.show_email && checkout.contact_email && (
                    <a href={`mailto:${checkout.contact_email}`} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <span>✉</span><span>Email</span>
                    </a>
                  )}
                  {theme.social?.facebook && (
                    <a href={theme.social.facebook} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <span>👥</span><span>Facebook</span>
                    </a>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Claim CTA for unowned shops */}
          {!shop.clerk_user_id && (
            <div className="mt-3">
              <ClaimButton href={`/s/${slug}/claim`} accent={accent} />
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
        sellerHasStripe={sellerHasStripe}
        mpEnabled={mpEnabled}
        hasClabe={hasClabe}
      />

      {/* ── Listings grid ────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
        {(mpEnabled || sellerHasStripe || hasPickup || hasScheduling || returnsLabel) && (
          <div className="flex flex-wrap gap-2 mb-5">
            {mpEnabled && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">Mercado Pago</span>}
            {sellerHasStripe && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">Tarjeta</span>}
            {hasPickup && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">Pickup{shipping.pickup_spots?.[0]?.name ? `: ${shipping.pickup_spots[0].name}` : ''}</span>}
            {hasScheduling && <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--color-surface-alt)] text-[var(--color-muted)]">{calcom.event_type_title ?? scheduling.links?.[0]?.label ?? 'Agenda disponible'}</span>}
            {returnsLabel && <span className="text-xs px-2.5 py-1 rounded-full bg-green-50 text-green-700">Devoluciones {returnsLabel}</span>}
          </div>
        )}
        {listings.length === 0 ? (
          <div className="text-center py-16 text-[var(--color-muted)]">
            <div className="text-4xl mb-3">📦</div>
            <p className="font-medium">Esta tienda aún no tiene anuncios.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-[var(--color-muted)] mb-3 sm:hidden">{listings.length} anuncios</p>
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
                    paymentMethods: { stripe: sellerHasStripe, mp: mpEnabled, spei: hasClabe },
                    href: `/l/${listing.id}`,
                    formattedPrice: formatPrice(listing),
                    status: listing.status,
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )

  // On a custom domain the root layout already wraps every page in the shop's
  // white-label shell (ChannelLayout), so the page just returns its content.
  return pageContent
}
