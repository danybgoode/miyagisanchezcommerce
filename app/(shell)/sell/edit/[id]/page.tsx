import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import EditForm from './EditForm'
import PublishToMl from './PublishToMl'
import { isEnabled } from '@/lib/flags'
import { getMlConnection } from '@/lib/ml-connection'
import { getMlProductLink } from '@/lib/ml-publish-bridge'
import type { MlLinkView } from '@/lib/ml-publish'
import { readPriceGrid, type PriceGrid } from '@/lib/price-grid'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Editar anuncio' }

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) redirect('/sign-in')

  // Fetch listing + verify ownership
  let { data, error } = await db
    .from('marketplace_listings')
    .select('id, medusa_product_id, title, description, price_cents, currency, listing_type, images, status, metadata, marketplace_shops!inner(clerk_user_id, slug)')
    .eq('medusa_product_id', id)
    .neq('status', 'deleted')
    .maybeSingle()

  if (!data && !error && /^[0-9a-f-]{36}$/i.test(id)) {
    const fallback = await db
      .from('marketplace_listings')
      .select('id, medusa_product_id, title, description, price_cents, currency, listing_type, images, status, metadata, marketplace_shops!inner(clerk_user_id, slug)')
      .eq('id', id)
      .neq('status', 'deleted')
      .maybeSingle()
    data = fallback.data
    error = fallback.error
  }

  if (error || !data) notFound()

  const shop = (data.marketplace_shops as unknown as { clerk_user_id: string; slug: string } | { clerk_user_id: string; slug: string }[])
  const shopData = Array.isArray(shop) ? shop[0] : shop
  if (shopData?.clerk_user_id !== userId) notFound()

  const listing = data as {
    id: string
    medusa_product_id: string | null
    title: string
    description: string | null
    price_cents: number | null
    currency: string
    listing_type: string
    images: Array<{ url: string; alt?: string }>
    status: string
    metadata: Record<string, unknown>
  }

  const medusaProductId = listing.medusa_product_id ?? listing.id

  // Fetch Medusa listing for quantity, attrs, category (view-safe endpoint)
  let availableQuantity: number | null = null
  let medusaAttrs: Record<string, unknown> = {}
  let medusaCategory = ''
  let medusaCustomFields: unknown = []
  try {
    const base = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
    const pub = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
    const r = await fetch(`${base}/store/listings/${medusaProductId}`, {
      headers: { 'x-publishable-api-key': pub },
      cache: 'no-store',
    })
    if (r.ok) {
      const d = await r.json()
      const ml = d?.listing
      if (ml) {
        if (listing.listing_type === 'product') {
          availableQuantity = ml.manage_inventory ? (ml.available_quantity ?? null) : null
        }
        medusaAttrs = (ml.attrs as Record<string, unknown>) ?? {}
        medusaCategory = (ml.category as string) ?? ''
        medusaCustomFields = (ml.metadata as Record<string, unknown> | undefined)?.custom_fields ?? []
      }
    }
  } catch { /* non-fatal */ }

  // Opciones (custom-print-products Story 2.4): the listing's price-grid — the
  // SAME route the public PDP reads, fetched FRESH (not the unstable_cache'd
  // getPriceGrid) so the editor never shows a stale grid right after a save.
  // The route only serves published listings, so skip drafts/paused (the
  // section shows an "activate first" state instead).
  const isActive = listing.status === 'active'
  let priceGrid: PriceGrid | null = null
  if (isActive && listing.listing_type === 'product') {
    try {
      const base = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
      const pub = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
      const r = await fetch(`${base}/store/listings/${medusaProductId}/price-grid`, {
        headers: { 'x-publishable-api-key': pub },
        cache: 'no-store',
      })
      if (r.ok) priceGrid = readPriceGrid(await r.json())
    } catch { /* non-fatal — section shows a reload state */ }
  }

  // Per-variant unit costs (COGS) — seller-private, so read via the
  // seller-scoped GET (the public listing/price-grid reads never carry them;
  // profit-analyzer S1 · US-1). Non-fatal: cost inputs start blank on error.
  const variantCosts: Record<string, number | null> = {}
  try {
    const clerkJwt = await getToken()
    if (clerkJwt) {
      const base = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
      const pub = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''
      const r = await fetch(`${base}/store/sellers/me/products/${medusaProductId}`, {
        headers: { 'x-publishable-api-key': pub, Authorization: `Bearer ${clerkJwt}` },
        cache: 'no-store',
      })
      if (r.ok) {
        const d = await r.json() as { variants?: Array<{ id: string; unit_cost_cents: number | null }> }
        for (const v of d.variants ?? []) variantCosts[v.id] = v.unit_cost_cents
      }
    }
  } catch { /* non-fatal */ }

  const typeLabel: Record<string, string> = {
    product: '📦 Producto',
    service: '🔧 Servicio',
    rental: '🔑 Renta',
    digital: '💻 Digital',
    subscription: '🔔 Suscripción',
  }

  // Mercado Libre publish (epic 03 · S3 · US-7/8/9). Dark behind `ml.publish_enabled`;
  // only for products, only when the shop has a connected ML account. Fails closed.
  let mlPublishLink: MlLinkView | undefined
  if (listing.listing_type === 'product' && shopData?.slug && (await isEnabled('ml.publish_enabled'))) {
    const [{ connection }, link] = await Promise.all([
      getMlConnection(shopData.slug),
      getMlProductLink(medusaProductId),
    ])
    if (connection?.status === 'connected') mlPublishLink = link
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm mb-6">
        <Link href="/shop/manage" className="text-[var(--color-accent)] hover:underline">
          ← Mi tienda
        </Link>
        <span className="text-[var(--color-muted)]">/</span>
        <span className="text-[var(--color-text)] font-medium">Editar anuncio</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Editar anuncio</h1>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-[var(--color-muted)]">
            {typeLabel[listing.listing_type] ?? listing.listing_type}
          </span>
          <span className="text-xs text-[var(--color-muted)]">·</span>
          <Link
            href={`/l/${listing.medusa_product_id ?? listing.id}`}
            target="_blank"
            className="text-xs text-[var(--color-accent)] hover:underline"
          >
            Ver anuncio ↗
          </Link>
        </div>
      </div>

      {listing.status === 'paused' && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm mb-6">
          ⏸ Este anuncio está pausado — no es visible para compradores. Actívalo desde &quot;Mi tienda&quot;.
        </div>
      )}

      <EditForm
        id={medusaProductId}
        priceGrid={priceGrid}
        isActive={isActive}
        knownMultiVariant={listing.metadata?.has_variants === true}
        variantCosts={variantCosts}
        shortlink={{
          shopSlug: shopData?.slug ?? '',
          code: (listing.metadata?.short_code as string | undefined) ?? '',
          slug: (listing.metadata?.short_slug as string | undefined) ?? '',
        }}
        initial={{
          title: listing.title,
          description: listing.description ?? '',
          price_cents: listing.price_cents,
          currency: listing.currency ?? 'MXN',
          listing_type: listing.listing_type,
          category: medusaCategory,
          available_quantity: availableQuantity,
          attrs: medusaAttrs,
          custom_fields: medusaCustomFields,
          images: (listing.images ?? []) as Array<{ url: string; alt?: string }>,
          state: (listing.metadata?.state as string | undefined) ?? '',
          municipio: (listing.metadata?.municipio as string | undefined) ?? '',
          estado_code: (listing.metadata?.estado_code as string | undefined) ?? '',
        }}
      />

      {mlPublishLink !== undefined && (
        <PublishToMl productId={medusaProductId} title={listing.title} initialLink={mlPublishLink} />
      )}
    </div>
  )
}
