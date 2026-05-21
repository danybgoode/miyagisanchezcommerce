import { notFound } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { getListing, formatPrice, conditionLabel } from '@/lib/listings'
import { getShopStripe } from '@/lib/stripe'
import BuyButton from '@/app/components/BuyButton'
import MercadoPagoButton from '@/app/components/MercadoPagoButton'
import MakeOfferButton from '@/app/components/MakeOfferButton'
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

function formatPhone(raw: string): string {
  // Strip non-digits, then format MX number for display
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  if (digits.length === 12 && digits.startsWith('52')) {
    const local = digits.slice(2)
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
  }
  return raw
}

function whatsappUrl(raw: string, title: string): string {
  const digits = raw.replace(/\D/g, '')
  // Ensure country code
  const full = digits.startsWith('52') ? digits : `52${digits}`
  const text = encodeURIComponent(`Hola, vi tu anuncio "${title}" en miyagisanchez.com y me interesa. ¿Sigue disponible?`)
  return `https://wa.me/${full}?text=${text}`
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [listing, clerkUser] = await Promise.all([getListing(id), currentUser()])
  if (!listing) notFound()

  // Extract contact info — phone can be on listing metadata (SerpAPI) or shop metadata
  const listingPhone = listing.metadata?.phone as string | null | undefined
  const shopPhone = listing.shop?.metadata?.phone as string | null | undefined
  const phone = listingPhone || shopPhone || null

  const shopWebsite = listing.shop?.metadata?.website as string | null | undefined
  const isClaimed = !!(listing.shop?.clerk_user_id && !listing.shop.clerk_user_id.startsWith('pending:'))

  // Digital goods
  const digitalFile = listing.metadata?.digital_file as { name?: string; size?: number; label?: string } | undefined
  const isDigital = listing.listing_type === 'digital'

  // Stripe — check if seller has connected payments
  const shopMeta = listing.shop?.metadata as Record<string, unknown> | null
  const stripeSettings = getShopStripe(shopMeta)
  const sellerHasStripe = !!(stripeSettings.charges_enabled && stripeSettings.account_id)
  // mp_enabled defaults true so existing shops without the column still show MP
  const sellerHasMp = (listing.shop as unknown as { mp_enabled?: boolean | null } | null)?.mp_enabled !== false
  const hasBuyablePrice = !!(listing.price_cents && listing.price_cents > 0)

  // REPUVE — vehicle history verification (autos only)
  const repuve = listing.metadata?.repuve as { status?: string; folio?: string; verified_at?: string } | undefined
  const showRepuve = listing.category === 'autos' && !!repuve?.status

  // Cal.com — scheduling
  const shopSettings = (shopMeta?.settings ?? {}) as Record<string, unknown>
  const calcomSettings = shopSettings.calcom as { connected?: boolean; booking_url?: string; event_type_title?: string } | undefined
  const shopHasCalcom = !!(calcomSettings?.connected && calcomSettings?.booking_url)
  const agendarLabel = listing.category === 'autos'
    ? '🚗 Agendar prueba de manejo'
    : listing.category === 'inmuebles'
    ? '🏠 Agendar visita'
    : listing.listing_type === 'service'
    ? '🕐 Agendar cita'
    : listing.listing_type === 'rental'
    ? '📅 Ver disponibilidad'
    : '📅 Agendar'

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <nav className="text-sm text-[var(--color-muted)] mb-4">
        <Link href="/" className="hover:text-[var(--color-text)]">Inicio</Link>
        {' › '}
        <Link href="/l" className="hover:text-[var(--color-text)]">Anuncios</Link>
        {listing.category && (
          <>
            {' › '}
            <Link href={`/l?category=${listing.category}`} className="hover:text-[var(--color-text)] capitalize">
              {listing.category}
            </Link>
          </>
        )}
        {' › '}
        <span className="text-[var(--color-text)]">{listing.title}</span>
      </nav>

      <div className="grid md:grid-cols-5 gap-8">
        {/* Images */}
        <div className="md:col-span-3">
          {listing.images?.[0] ? (
            <img src={listing.images[0].url} alt={listing.title} className="w-full rounded-lg border border-[var(--color-border)]" />
          ) : (
            <div className="w-full aspect-video bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg flex items-center justify-center text-5xl">📦</div>
          )}
          {listing.images.length > 1 && (
            <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
              {listing.images.slice(1).map((img, i) => (
                <img key={i} src={img.url} alt={img.alt ?? ''} className="w-16 h-16 object-cover rounded-md border border-[var(--color-border)] shrink-0" />
              ))}
            </div>
          )}

          {/* Description */}
          {listing.description && (
            <div className="mt-6 border-t border-[var(--color-border)] pt-5">
              <h2 className="font-semibold mb-3 text-[var(--color-text)]">Descripción</h2>
              <p className="text-sm text-[var(--color-text)] whitespace-pre-line leading-relaxed">{listing.description}</p>
            </div>
          )}

          {/* Source link */}
          {listing.source_url && (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              <a
                href={listing.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-accent)] no-underline transition-colors"
              >
                <span>Ver anuncio original</span>
                <span className="text-xs">↗</span>
                {listing.source_platform && (
                  <span className="text-xs bg-[var(--color-background)] border border-[var(--color-border)] px-1.5 py-0.5 rounded capitalize">
                    {listing.source_platform.replace('_', ' ')}
                  </span>
                )}
              </a>
            </div>
          )}
        </div>

        {/* Details sidebar */}
        <div className="md:col-span-2">
          <h1 className="text-xl font-bold text-[var(--color-text)] mb-2 leading-snug">{listing.title}</h1>
          <p className="text-2xl font-bold text-[var(--color-accent)] mb-1">{formatPrice(listing)}</p>
          <p className="text-xs text-[var(--color-muted)] mb-4">{timeAgo(listing.created_at)} · {listing.views} vistas</p>

          {/* Digital goods badge */}
          {isDigital && digitalFile && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 mb-4">
              <span className="text-xl">💻</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-blue-800">Producto digital</div>
                <div className="text-xs text-blue-600 truncate">
                  {digitalFile.label} · {digitalFile.name}
                  {digitalFile.size && ` · ${(digitalFile.size / 1024 / 1024).toFixed(1)} MB`}
                </div>
              </div>
            </div>
          )}

          {/* REPUVE badge */}
          {showRepuve && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-4 text-sm font-medium ${
              repuve!.status === 'sin_reporte'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}>
              <span className="text-base">{repuve!.status === 'sin_reporte' ? '✓' : '⚠'}</span>
              <div>
                <span className="font-semibold">
                  {repuve!.status === 'sin_reporte' ? 'Sin reporte REPUVE' : 'Con reporte REPUVE'}
                </span>
                {repuve!.folio && (
                  <span className="ml-2 text-xs font-mono opacity-70">Folio: {repuve!.folio}</span>
                )}
              </div>
            </div>
          )}

          <dl className="space-y-2 text-sm mb-5">
            {listing.condition && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-muted)] w-24 shrink-0">Condición</dt>
                <dd className="font-medium">{conditionLabel(listing.condition)}</dd>
              </div>
            )}
            {listing.location && (
              <div className="flex gap-2">
                <dt className="text-[var(--color-muted)] w-24 shrink-0">Ubicación</dt>
                <dd>{listing.location}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted)] w-24 shrink-0">Tipo</dt>
              <dd className="capitalize">
                {isDigital ? '💻 Digital' : listing.listing_type === 'service' ? 'Servicio' : listing.listing_type === 'rental' ? 'Renta' : 'Producto'}
              </dd>
            </div>
          </dl>

          {/* ── Buy / Download CTA ───────────────────── */}
          {isDigital && hasBuyablePrice && (
            <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">📥</span>
                <div>
                  <div className="text-sm font-semibold text-blue-800">Entrega automática al instante</div>
                  <div className="text-xs text-blue-600">Recibirás el archivo al completar el pago.</div>
                </div>
              </div>
              <BuyButton
                listingId={listing.id}
                price={formatPrice(listing)}
                isDigital
                sellerHasStripe={sellerHasStripe}
              />
            </div>
          )}

          {/* Physical / service buy button + make offer */}
          {!isDigital && hasBuyablePrice && isClaimed && (
            <div className="mb-4 space-y-2">
              {/* MercadoPago — primary for MX (cards, OXXO, wallets, installments) */}
              {sellerHasMp && (
                <MercadoPagoButton
                  listingId={listing.id}
                  price={formatPrice(listing)}
                  buyerEmail={clerkUser?.emailAddresses[0]?.emailAddress}
                />
              )}
              {/* Stripe — international cards fallback */}
              {sellerHasStripe && (
                <BuyButton
                  listingId={listing.id}
                  price={formatPrice(listing)}
                  isDigital={false}
                  sellerHasStripe={sellerHasStripe}
                />
              )}
              <MakeOfferButton
                listing={{
                  id: listing.id,
                  title: listing.title,
                  price_cents: listing.price_cents!,
                  currency: listing.currency,
                  imageUrl: listing.images?.[0]?.url ?? null,
                }}
                buyerInfo={clerkUser ? {
                  name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' '),
                  email: clerkUser.emailAddresses[0]?.emailAddress ?? '',
                } : undefined}
              />
            </div>
          )}

          {/* ── Contact block ─────────────────────────── */}
          <div className="border border-[var(--color-border)] rounded-lg overflow-hidden mb-4">
            {/* Seller */}
            {listing.shop && (
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <p className="text-xs text-[var(--color-muted)] mb-1">Vendedor</p>
                <Link href={`/s/${listing.shop.slug}`} className="font-semibold text-sm no-underline text-[var(--color-text)] hover:text-[var(--color-accent)]">
                  {listing.shop.verified && <span className="text-[var(--color-accent)] mr-1">✓</span>}
                  {listing.shop.name}
                </Link>
                {listing.shop.location && <p className="text-xs text-[var(--color-muted)] mt-0.5">{listing.shop.location}</p>}
              </div>
            )}

            {/* Cal.com — Agendar */}
            {shopHasCalcom && (
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <a
                  href={calcomSettings!.booking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-[var(--color-text)] text-white font-semibold py-2.5 rounded-md text-sm no-underline hover:opacity-90 transition-opacity"
                >
                  <span>{agendarLabel}</span>
                  <span className="text-xs opacity-70">↗</span>
                </a>
                <p className="text-xs text-center text-[var(--color-muted)] mt-1.5">
                  {calcomSettings!.event_type_title ?? 'Elige tu horario disponible'}
                </p>
              </div>
            )}

            {/* WhatsApp CTA — if we have a phone number */}
            {phone && (
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <a
                  href={whatsappUrl(phone, listing.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-[#25D366] text-white font-semibold py-2.5 rounded-md text-sm no-underline hover:bg-[#22c55e] transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Contactar por WhatsApp
                </a>
                <p className="text-xs text-center text-[var(--color-muted)] mt-1.5">{formatPhone(phone)}</p>
              </div>
            )}

            {/* Website link if shop has one */}
            {shopWebsite && (
              <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
                <a
                  href={shopWebsite.startsWith('http') ? shopWebsite : `https://${shopWebsite}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--color-accent)] no-underline hover:underline flex items-center gap-1"
                >
                  🌐 Sitio web ↗
                </a>
              </div>
            )}

            {/* If shop is claimed — show "Contact seller" panel */}
            {isClaimed && !phone && (
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <Link
                  href={`/s/${listing.shop!.slug}`}
                  className="flex items-center justify-center gap-2 w-full bg-[var(--color-accent)] text-white font-semibold py-2.5 rounded-md text-sm no-underline hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  Ver perfil del vendedor →
                </Link>
              </div>
            )}

            {/* Claim nudge for unclaimed shops */}
            {listing.shop && !isClaimed && (
              <div className="px-4 py-2.5 bg-[var(--color-background)]">
                <Link href={`/s/${listing.shop.slug}/claim`} className="text-xs text-[var(--color-accent)] no-underline hover:underline">
                  ¿Es tuya esta tienda? Reclamar gratis →
                </Link>
              </div>
            )}
          </div>

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {listing.tags.map(tag => (
                <Link key={tag} href={`/l?q=${encodeURIComponent(tag)}`}
                  className="text-xs border border-[var(--color-border)] rounded px-2 py-0.5 text-[var(--color-muted)] no-underline hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]">
                  {tag}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
