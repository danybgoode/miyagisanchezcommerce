import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import EditForm from './EditForm'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Editar anuncio' }

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  // Fetch listing + verify ownership
  const { data, error } = await db
    .from('marketplace_listings')
    .select('id, title, description, price_cents, currency, listing_type, images, status, metadata, marketplace_shops!inner(clerk_user_id, slug)')
    .eq('id', id)
    .neq('status', 'deleted')
    .single()

  if (error || !data) notFound()

  const shop = (data.marketplace_shops as unknown as { clerk_user_id: string; slug: string } | { clerk_user_id: string; slug: string }[])
  const shopData = Array.isArray(shop) ? shop[0] : shop
  if (shopData?.clerk_user_id !== userId) notFound()

  const listing = data as {
    id: string
    title: string
    description: string | null
    price_cents: number | null
    currency: string
    listing_type: string
    images: Array<{ url: string; alt?: string }>
    status: string
    metadata: Record<string, unknown>
  }

  const typeLabel: Record<string, string> = {
    product: '📦 Producto',
    service: '🔧 Servicio',
    rental: '🔑 Renta',
    digital: '💻 Digital',
    subscription: '🔔 Suscripción',
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
            href={`/l/${listing.id}`}
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
        id={listing.id}
        initial={{
          title: listing.title,
          description: listing.description ?? '',
          price_cents: listing.price_cents,
          currency: listing.currency ?? 'MXN',
          listing_type: listing.listing_type,
          images: (listing.images ?? []) as Array<{ url: string; alt?: string }>,
        }}
      />
    </div>
  )
}
