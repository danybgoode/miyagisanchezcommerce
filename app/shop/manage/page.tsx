import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { ensureSupabaseShopMirror, syncSupabaseListingMirror, type MedusaSellerForMirror } from '@/lib/provisioning'
import ManageDashboard from './ManageDashboard'

export const metadata = {
  title: 'Mi tienda — Miyagi Sánchez',
}

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

interface MedusaListingForManage {
  id: string
  title: string
  price_cents: number | null
  currency: string
  category: string | null
  listing_type: string
  condition: string | null
  status: string
  views: number
  images: Array<{ url: string; alt?: string | null }>
  created_at: string
}

function medusaFetch(path: string, clerkJwt: string) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })
}

export default async function ManagePage() {
  const user = await currentUser()
  // Middleware protects this route, but be defensive
  if (!user) redirect('/sign-in')

  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) redirect('/sign-in')

  // Medusa owns sellers/products after the migration. The Supabase mirror is
  // kept only for seller-console features that still use UUID foreign keys.
  const sellerRes = await medusaFetch('/store/sellers/me', clerkJwt)
  if (sellerRes.status === 404) redirect('/sell')
  if (!sellerRes.ok) throw new Error('No se pudo cargar tu tienda.')

  const { seller } = await sellerRes.json() as { seller: MedusaSellerForMirror }
  const shopMirror = await ensureSupabaseShopMirror(seller, user.id)

  const productsRes = await medusaFetch('/store/sellers/me/products?limit=200', clerkJwt)
  const productsData = productsRes.ok
    ? await productsRes.json() as { listings?: MedusaListingForManage[] }
    : { listings: [] }

  const listings = (productsData.listings ?? []).map((listing) => ({
    id: listing.id,
    title: listing.title,
    price_cents: listing.price_cents,
    currency: listing.currency,
    category: listing.category,
    listing_type: listing.listing_type,
    condition: listing.condition,
    status: listing.status,
    views: listing.views,
    images: listing.images.map((image) => ({
      url: image.url,
      ...(image.alt ? { alt: image.alt } : {}),
    })),
    created_at: listing.created_at,
  }))

  if (shopMirror?.id) {
    await Promise.all(
      listings.map((listing) =>
        syncSupabaseListingMirror(shopMirror.id, {
          id: listing.id,
          title: listing.title,
          price_cents: listing.price_cents,
          currency: listing.currency,
          condition: listing.condition,
          listing_type: listing.listing_type,
          category: listing.category,
          images: listing.images,
          status: listing.status,
        }),
      ),
    )
  }

  // ── Fetch listings + pending offers + pending orders in parallel ───────────
  const [{ count: pendingOffersCount }, { count: pendingOrdersCount }] = shopMirror?.id
    ? await Promise.all([
        db
          .from('marketplace_offers')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', shopMirror.id)
          .eq('status', 'pending'),
        db
          .from('marketplace_orders')
          .select('id', { count: 'exact', head: true })
          .eq('shop_id', shopMirror.id)
          .in('status', ['paid', 'processing']),
      ])
    : [{ count: 0 }, { count: 0 }]

  return (
    <ManageDashboard
      shop={{
        id: seller.id,
        slug: seller.slug,
        name: seller.name,
        location: seller.location ?? null,
      }}
      initialListings={listings}
      pendingOffersCount={pendingOffersCount ?? 0}
      pendingOrdersCount={pendingOrdersCount ?? 0}
    />
  )
}
