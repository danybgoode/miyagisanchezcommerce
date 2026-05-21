import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getShop, getShopListings, formatPrice } from '@/lib/listings'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const shop = await getShop(slug)
  if (!shop) return { title: 'Tienda no encontrada' }
  const theme = (shop.metadata as Record<string, unknown> | null)?.settings as Record<string, unknown> | undefined
  const t = (theme?.theme ?? {}) as Record<string, unknown>
  return {
    title: shop.name,
    description: (t.tagline as string | undefined) ?? shop.description ?? undefined,
    openGraph: {
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
  const shop = await getShop(slug)
  if (!shop) notFound()
  const listings = await getShopListings(shop.id)

  // Extract theme from metadata
  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const theme = (settings.theme ?? {}) as {
    banner_url?: string | null
    accent_color?: string | null
    tagline?: string | null
    social?: Social
  }

  const accent = theme.accent_color ?? 'var(--color-accent)'
  const hasBanner = !!theme.banner_url

  return (
    <div style={{ '--shop-accent': accent } as React.CSSProperties}>

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
                  <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: accent }}>
                    ✓ Verificado
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
          {(shop.description || theme.social) && (
            <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              {shop.description && (
                <p className="text-sm text-[var(--color-muted)] max-w-xl">{shop.description}</p>
              )}
              {theme.social && Object.values(theme.social).some(Boolean) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {theme.social.instagram && (
                    <a href={`https://instagram.com/${theme.social.instagram}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-text)] transition-colors no-underline">
                      <span>📸</span><span>@{theme.social.instagram}</span>
                    </a>
                  )}
                  {theme.social.tiktok && (
                    <a href={`https://tiktok.com/@${theme.social.tiktok}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-text)] transition-colors no-underline">
                      <span>🎵</span><span>@{theme.social.tiktok}</span>
                    </a>
                  )}
                  {theme.social.whatsapp && (
                    <a href={`https://wa.me/${theme.social.whatsapp}`} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-green-700 hover:bg-green-100 transition-colors no-underline">
                      <span>💬</span><span>WhatsApp</span>
                    </a>
                  )}
                  {theme.social.facebook && (
                    <a href={theme.social.facebook} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors no-underline">
                      <span>👥</span><span>Facebook</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Claim CTA for unowned shops */}
          {!shop.clerk_user_id && (
            <div className="mt-3">
              <Link href={`/s/${slug}/claim`}
                className="inline-block text-sm border rounded px-3 py-1 no-underline transition-colors"
                style={{ color: accent, borderColor: accent }}
                onMouseOver={e => { (e.currentTarget as HTMLElement).style.backgroundColor = accent; (e.currentTarget as HTMLElement).style.color = '#fff' }}
                onMouseOut={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLElement).style.color = accent }}
              >
                ¿Es tu tienda? Reclamar →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Listings grid ────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
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
                <Link key={listing.id} href={`/l/${listing.id}`} className="no-underline group">
                  <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden transition-all group-hover:shadow-md group-hover:border-opacity-0"
                    style={{ ['--tw-ring-color' as string]: accent }}>
                    {listing.images?.[0] ? (
                      <img src={listing.images[0].url} alt={listing.title} className="w-full h-36 object-cover" />
                    ) : (
                      <div className="w-full h-36 bg-[var(--color-surface-alt)] flex items-center justify-center text-3xl">📦</div>
                    )}
                    <div className="p-2.5">
                      <p className="text-xs font-medium text-[var(--color-text)] line-clamp-2 leading-snug">{listing.title}</p>
                      <p className="text-sm font-bold mt-1" style={{ color: accent }}>{formatPrice(listing)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
