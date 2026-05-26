import { notFound } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, formatPrice, conditionLabel } from '@/lib/listings'
import { getShopStripe } from '@/lib/stripe'
import BuyButton from '@/app/components/BuyButton'
import MercadoPagoButton from '@/app/components/MercadoPagoButton'
import MakeOfferButton from '@/app/components/MakeOfferButton'
import FavoriteButton from '@/app/components/FavoriteButton'
import SubscriptionSection from './SubscriptionSection'
import { db } from '@/lib/supabase'
import type { Metadata } from 'next'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const listing = await getListing(id)
  if (!listing) return { title: 'Anuncio no encontrado' }
  return { title: listing.title, description: listing.description ?? undefined }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Ahora mismo'
  if (mins < 60) return `Hace ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `Hace ${hrs} h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `Hace ${days} día${days > 1 ? 's' : ''}`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `Hace ${weeks} semana${weeks > 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  if (months < 12) return `Hace ${months} mes${months > 1 ? 'es' : ''}`
  return `Hace ${Math.floor(months / 12)} año${Math.floor(months / 12) > 1 ? 's' : ''}`
}

function whatsappUrl(raw: string, title: string): string {
  const digits = raw.replace(/\D/g, '')
  const full = digits.startsWith('52') ? digits : `52${digits}`
  const text = encodeURIComponent(`Hola, vi tu anuncio "${title}" en miyagisanchez.com y me interesa. ¿Sigue disponible?`)
  return `https://wa.me/${full}?text=${text}`
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [listing, clerkUser] = await Promise.all([getListing(id), currentUser()])
  if (!listing) notFound()

  const isSignedIn = !!clerkUser
  const listingPhone = listing.metadata?.phone as string | null | undefined
  const shopPhone = listing.shop?.metadata?.phone as string | null | undefined
  const phone = listingPhone || shopPhone || null

  const shopWebsite = listing.shop?.metadata?.website as string | null | undefined
  const isClaimed = !!(listing.shop?.clerk_user_id && !listing.shop.clerk_user_id.startsWith('pending:'))
  const digitalFile = listing.metadata?.digital_file as { name?: string; size?: number; label?: string } | undefined
  const isDigital = listing.listing_type === 'digital'
  const shopMeta = listing.shop?.metadata as Record<string, unknown> | null
  const stripeSettings = getShopStripe(shopMeta)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id && stripeSettings.enabled !== false)
  const sellerHasMp = (listing.shop as unknown as { mp_enabled?: boolean | null } | null)?.mp_enabled !== false
  const hasBuyablePrice = !!(listing.price_cents && listing.price_cents > 0)
  const repuve = listing.metadata?.repuve as { status?: string; folio?: string; verified_at?: string } | undefined
  const showRepuve = listing.category === 'autos' && !!repuve?.status
  const shopSettings = (shopMeta?.settings ?? {}) as Record<string, unknown>
  const calcomSettings = shopSettings.calcom as { connected?: boolean; booking_url?: string; event_type_title?: string } | undefined
  const ordersSettings = shopSettings.orders as { processing_time?: string } | undefined
  const returnsPolicySettings = shopSettings.returns_policy as { window?: string; conditions?: string; shipping_paid_by?: string; custom_note?: string } | undefined
  const PROCESSING_LABELS: Record<string, string> = { '1d': '1 día hábil', '1-3d': '1–3 días hábiles', '3-5d': '3–5 días hábiles', '1-2w': '1–2 semanas' }
  const processingLabel = ordersSettings?.processing_time ? PROCESSING_LABELS[ordersSettings.processing_time] ?? ordersSettings.processing_time : null
  // Only show a positive return window as a trust signal — "no returns" is never surfaced
  // on the PDP (it's the implicit default and negative framing; disputes still apply via
  // platform protection regardless of seller policy).
  const returnsLabel = returnsPolicySettings?.window === '7d'  ? '7 días'
    : returnsPolicySettings?.window === '14d' ? '14 días'
    : returnsPolicySettings?.window === '30d' ? '30 días'
    : null
  const isSubscription = (listing.listing_type as string) === 'subscription'
  type StoredTier = { id: string; label: string; price_cents: number; interval: 'month' | 'year'; features: string[]; is_highlighted: boolean; stripe_price_id?: string; mp_preapproval_plan_id?: string }
  const storedTiers = listing.metadata?.subscription_tiers as StoredTier[] | undefined
  const subMeta = listing.metadata?.subscription as { interval?: 'month' | 'year'; content_description?: string; stripe_price_id?: string } | undefined
  const subTiers: StoredTier[] = storedTiers && storedTiers.length > 0
    ? storedTiers
    : subMeta ? [{ id: 'default', label: 'Suscripción', price_cents: listing.price_cents ?? 0, interval: subMeta.interval ?? 'month', features: subMeta.content_description ? subMeta.content_description.split('\n').filter(Boolean) : [], is_highlighted: false, stripe_price_id: subMeta.stripe_price_id }] : []
  const checkoutSettings = shopSettings.checkout as { bank_transfer?: { clabe?: string; bank_name?: string; account_holder?: string } } | undefined
  const hasClabe = !!(checkoutSettings?.bank_transfer?.clabe?.trim() && checkoutSettings.bank_transfer.clabe.trim().length === 18)
  const shopHasCalcom = !!(calcomSettings?.connected && calcomSettings?.booking_url)
  const agendarLabel = listing.category === 'autos' ? '🚗 Agendar prueba de manejo' : listing.category === 'inmuebles' ? '🏠 Agendar visita' : listing.listing_type === 'service' ? '🕐 Agendar cita' : listing.listing_type === 'rental' ? '📅 Ver disponibilidad' : '📅 Agendar'

  // Check if favorited
  let isFavorited = false
  if (clerkUser) {
    const { data: fav } = await db.from('marketplace_favorites').select('id').eq('clerk_user_id', clerkUser.id).eq('listing_id', id).maybeSingle()
    isFavorited = !!fav
  }

  const showBuyButtons = !isDigital && !isSubscription && hasBuyablePrice && isClaimed
  const images = listing.images ?? []

  // Reusable CTA buttons block (rendered both inline on desktop and in sticky bar on mobile)
  const ctaButtons = showBuyButtons ? (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      <MakeOfferButton
        listing={{ id: listing.id, title: listing.title, price_cents: listing.price_cents!, currency: listing.currency, imageUrl: listing.images?.[0]?.url ?? null }}
        buyerInfo={clerkUser ? { name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' '), email: clerkUser.emailAddresses[0]?.emailAddress ?? '' } : undefined}
        isSignedIn={isSignedIn}
      />
      {sellerHasMp ? (
        <MercadoPagoButton listingId={listing.id} price={formatPrice(listing)} buyerEmail={clerkUser?.emailAddresses[0]?.emailAddress} isSignedIn={isSignedIn} />
      ) : sellerHasStripe ? (
        <BuyButton listingId={listing.id} price={formatPrice(listing)} isDigital={false} sellerHasStripe={sellerHasStripe} isSignedIn={isSignedIn} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--fg-muted)', textAlign: 'center', padding: '0 8px' }}>
          Contacta al vendedor para pagar
        </div>
      )}
    </div>
  ) : null

  return (
    /* Mobile: single-col centered. Desktop: unconstrained width up to 960px, 2-col grid */
    <div
      className="max-w-[640px] md:max-w-[960px] mx-auto pb-[120px] md:px-6 md:pb-12"
    >
      {/* ── Desktop 2-col grid ──────────────────────────────────────────────── */}
      <div className="md:grid md:gap-10 md:[grid-template-columns:46%_1fr]">

      {/* ═══════════════════ LEFT COLUMN: Gallery (sticky on desktop) ════════ */}
      <div className="md:col-start-1 md:row-start-1">
        {/* Sticky wrapper — desktop only */}
        <div className="md:sticky md:top-[72px]">
          {/* ── Image gallery ───────────────────────────────────────────── */}
          <div style={{ position: 'relative' }}>
            {images.length === 0 ? (
              <div style={{ width: '100%', aspectRatio: '4/3', background: 'var(--bg-sunk)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="iconoir-package" style={{ fontSize: 64, color: 'var(--fg-subtle)' }} />
              </div>
            ) : images.length === 1 ? (
              <img src={images[0].url} alt={listing.title} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', borderRadius: 'var(--r-lg)' }} className="md:rounded-xl" />
            ) : (
              <div>
                <img src={images[0].url} alt={listing.title} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} className="md:rounded-xl" />
                <div style={{ display: 'flex', gap: 4, padding: '4px 4px 0', overflowX: 'auto', background: 'var(--bg-sunk)' }} className="hide-scrollbar md:rounded-b-xl">
                  {images.slice(1).map((img, i) => (
                    <img key={i} src={img.url} alt="" style={{ height: 64, width: 64, objectFit: 'cover', borderRadius: 4, flexShrink: 0, opacity: 0.85 }} />
                  ))}
                </div>
              </div>
            )}

            {/* Favorite button overlay */}
            <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10 }}>
              <FavoriteButton listingId={listing.id} initialFavorited={isFavorited} isSignedIn={isSignedIn} />
            </div>

            {/* Views badge */}
            <div style={{ position: 'absolute', bottom: images.length > 1 ? 76 : 12, left: 12, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 4 }}>
              <i className="iconoir-eye" style={{ fontSize: 12, color: '#fff' }} />
              <span style={{ fontSize: 11, color: '#fff', fontWeight: 500 }}>{listing.views}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════ RIGHT COLUMN: Content ═══════════════════════════ */}
      <div className="md:col-start-2 md:row-start-1">

      {/* ── Content ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 16px 0' }} className="md:pt-0 md:px-0">

        {/* Breadcrumbs */}
        <nav style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <Link href="/" style={{ color: 'var(--fg-subtle)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Inicio</Link>
          <span>›</span>
          <Link href="/l" style={{ color: 'var(--fg-subtle)', textDecoration: 'none' }} className="hover:text-[var(--fg)]">Anuncios</Link>
          {listing.category && (<><span>›</span><Link href={`/l?category=${listing.category}`} style={{ color: 'var(--fg-subtle)', textDecoration: 'none' }} className="hover:text-[var(--fg)] capitalize">{listing.category}</Link></>)}
        </nav>

        {/* Title + meta */}
        <h1 style={{ fontWeight: 700, fontSize: 20, lineHeight: 1.3, marginBottom: 4 }}>{listing.title}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {listing.condition && (
            <span style={{ fontSize: 12, fontWeight: 500, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>
              {conditionLabel(listing.condition)}
            </span>
          )}
          <span style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{timeAgo(listing.created_at)}</span>
          {listing.location && (
            <span style={{ fontSize: 12, color: 'var(--fg-subtle)', display: 'flex', alignItems: 'center', gap: 3 }}>
              <i className="iconoir-map-pin" style={{ fontSize: 11 }} />{listing.location}
            </span>
          )}
        </div>

        {/* Price */}
        <div style={{ marginBottom: (processingLabel || returnsLabel) ? 10 : 16 }}>
          <p style={{ fontWeight: 800, fontSize: 28, color: 'var(--fg)', lineHeight: 1 }}>{formatPrice(listing)}</p>
          {listing.currency && listing.currency !== 'MXN' && (
            <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 2 }}>{listing.currency}</p>
          )}
        </div>

        {/* Order info pills */}
        {(processingLabel || returnsLabel) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {processingLabel && (
              <span style={{ fontSize: 12, background: 'var(--bg-sunk)', color: 'var(--fg-muted)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <i className="iconoir-box" style={{ fontSize: 11 }} />
                Lista en {processingLabel}
              </span>
            )}
            {returnsLabel && (
              <span style={{ fontSize: 12, background: 'var(--success-soft)', color: 'var(--success)', borderRadius: 'var(--r-pill)', padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <i className="iconoir-undo" style={{ fontSize: 11 }} />
                Devoluciones: {returnsLabel}
              </span>
            )}
          </div>
        )}

        {/* ── Badges ──────────────────────────────────────────────────────────── */}
        {isDigital && digitalFile && (
          <div className="flex items-center gap-2" style={{ background: 'var(--agent-soft)', borderRadius: 'var(--r-md)', padding: '10px 12px', marginBottom: 12 }}>
            <i className="iconoir-pc-mouse" style={{ fontSize: 20, color: 'var(--agent)', flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--agent)' }}>Producto digital — entrega automática</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {digitalFile.label} · {digitalFile.name}
                {digitalFile.size && ` · ${(digitalFile.size / 1024 / 1024).toFixed(1)} MB`}
              </div>
            </div>
          </div>
        )}

        {showRepuve && (
          <div className="flex items-center gap-2" style={{ background: repuve!.status === 'sin_reporte' ? 'var(--success-soft)' : 'var(--danger-soft)', borderRadius: 'var(--r-md)', padding: '10px 12px', marginBottom: 12 }}>
            <i className={repuve!.status === 'sin_reporte' ? 'iconoir-check-circle' : 'iconoir-warning-triangle'} style={{ fontSize: 18, color: repuve!.status === 'sin_reporte' ? 'var(--success)' : 'var(--danger)', flexShrink: 0 }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: repuve!.status === 'sin_reporte' ? 'var(--success)' : 'var(--danger)' }}>
                {repuve!.status === 'sin_reporte' ? 'Sin reporte REPUVE' : 'Con reporte REPUVE'}
              </span>
              {repuve!.folio && <span style={{ marginLeft: 8, fontSize: 11, fontFamily: 'var(--font-mono)', opacity: 0.7 }}>Folio: {repuve!.folio}</span>}
            </div>
          </div>
        )}

        {/* ── Desktop inline CTAs (buy now + make offer) ─────────────────────── */}
        {showBuyButtons && (
          <div className="hidden md:block" style={{ marginBottom: 20, padding: '16px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
            {ctaButtons}
          </div>
        )}

        {/* ── Subscription CTA (inline, not sticky) ───────────────────────────── */}
        {isSubscription && subTiers.length > 0 && isClaimed && (
          <div style={{ marginBottom: 20 }}>
            <SubscriptionSection
              listingId={listing.id}
              tiers={subTiers}
              shopName={listing.shop?.name ?? ''}
              hasStripe={sellerHasStripe}
              hasClabe={hasClabe}
              hasMp={sellerHasMp}
              isSignedIn={isSignedIn}
              buyerDisplayName={clerkUser ? [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') : undefined}
              buyerUserEmail={clerkUser?.emailAddresses[0]?.emailAddress}
            />
          </div>
        )}

        {/* ── Digital buy (inline, not sticky) ────────────────────────────────── */}
        {isDigital && hasBuyablePrice && (
          <div style={{ background: 'var(--agent-soft)', borderRadius: 'var(--r-lg)', padding: 16, marginBottom: 20 }}>
            <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
              <i className="iconoir-download-circle-solid" style={{ fontSize: 22, color: 'var(--agent)' }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--agent)' }}>Entrega automática al instante</div>
                <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>Recibirás el archivo al completar el pago.</div>
              </div>
            </div>
            <BuyButton listingId={listing.id} price={formatPrice(listing)} isDigital sellerHasStripe={sellerHasStripe} isSignedIn={isSignedIn} />
          </div>
        )}

        {/* ── Seller card ──────────────────────────────────────────────────────── */}
        {listing.shop && (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden', marginBottom: 20 }}>
            <Link href={`/s/${listing.shop.slug}`} className="no-underline block">
              <div className="flex items-center gap-3" style={{ padding: '14px 16px' }}>
                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {listing.shop.logo_url ? (
                    <img src={listing.shop.logo_url as unknown as string} alt={listing.shop.name} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <i className="iconoir-shop" style={{ fontSize: 20, color: 'var(--accent)' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
                      {listing.shop.verified && <span style={{ color: 'var(--accent)', marginRight: 3 }}>✓</span>}
                      {listing.shop.name}
                    </span>
                  </div>
                  {listing.shop.location && (
                    <p style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 1 }}>
                      <i className="iconoir-map-pin" style={{ fontSize: 11, verticalAlign: 'middle', marginRight: 2 }} />
                      {listing.shop.location}
                    </p>
                  )}
                </div>
                <i className="iconoir-arrow-right" style={{ fontSize: 16, color: 'var(--fg-subtle)', flexShrink: 0 }} />
              </div>
            </Link>

            {/* WhatsApp */}
            {phone && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
                <a
                  href={whatsappUrl(phone, listing.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-lg no-underline"
                  style={{ width: '100%', justifyContent: 'center', background: '#25D366', color: '#fff', borderRadius: 'var(--r-pill)' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Contactar por WhatsApp
                </a>
              </div>
            )}

            {/* Cal.com */}
            {shopHasCalcom && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px' }}>
                <a href={calcomSettings!.booking_url} target="_blank" rel="noopener noreferrer" className="btn btn-dark btn-lg no-underline" style={{ width: '100%', justifyContent: 'center' }}>
                  <i className="iconoir-calendar" style={{ fontSize: 16 }} />
                  {agendarLabel.replace(/^[^\s]+\s/, '')}
                  <i className="iconoir-arrow-up-right" style={{ fontSize: 12, opacity: 0.6 }} />
                </a>
              </div>
            )}

            {/* Claim nudge */}
            {!isClaimed && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', background: 'var(--bg-sunk)' }}>
                <Link href={`/s/${listing.shop.slug}/claim`} style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                  ¿Es tuya esta tienda? Reclamar gratis →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ── Description ──────────────────────────────────────────────────────── */}
        {listing.description && (
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>Descripción</h2>
            <p style={{ fontSize: 14, color: 'var(--fg)', lineHeight: 1.6, whiteSpace: 'pre-line' }}>{listing.description}</p>
          </div>
        )}

        {/* ── Source link ──────────────────────────────────────────────────────── */}
        {listing.source_url && (
          <div style={{ marginBottom: 20 }}>
            <a href={listing.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: 'var(--fg-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Ver anuncio original
              <i className="iconoir-arrow-up-right" style={{ fontSize: 12 }} />
              {listing.source_platform && <span style={{ fontSize: 11, background: 'var(--bg-sunk)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 4, textTransform: 'capitalize' }}>{listing.source_platform.replace('_', ' ')}</span>}
            </a>
          </div>
        )}

        {/* Tags */}
        {listing.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            {listing.tags.map(tag => (
              <Link key={tag} href={`/l?q=${encodeURIComponent(tag)}`} className="chip no-underline" style={{ fontSize: 12, padding: '4px 12px' }}>{tag}</Link>
            ))}
          </div>
        )}
      </div>
      </div>{/* end right column */}

      </div>{/* end 2-col grid */}

      {/* ── Sticky CTA bar — mobile only ────────────────────────────────────────
          Hidden on desktop (md+); desktop shows CTAs inline above seller card.
          Only shown for physical/service products. Digital + subscriptions render
          their CTAs inline because they have extra context (tiers, file info). */}
      {showBuyButtons && (
        <div
          className="md:hidden"
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 80,
            background: 'var(--bg-elevated)',
            borderTop: '1px solid var(--border)',
            padding: '12px 16px',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
            backdropFilter: 'blur(20px)',
          }}
        >
          {ctaButtons}
        </div>
      )}
    </div>
  )
}
