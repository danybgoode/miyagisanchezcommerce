import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { filterOutDeleted, DELETED_STATUS } from '@/lib/listing-lifecycle'
import { CATEGORIES } from '@/lib/types'
import { CATALOG_STATUS_FILTERS } from '@/lib/catalog-status'
import { isEnabled } from '@/lib/flags'
import { resolveMlSyncEntitlement } from '@/lib/ml-sync-entitlement-server'
import { buildCatalogQuery, buildCatalogPageUrl, CATALOG_PAGE_SIZE, type CatalogSearchParams } from '@/lib/catalog-query'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import CatalogFilterBar from './CatalogFilterBar'
import CatalogTable, { type CatalogListing } from './CatalogTable'

export const metadata = { title: 'Catálogo — Mi tienda' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

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

export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  const params = await searchParams
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) redirect('/sign-in')

  const sellerRes = await medusaFetch('/store/sellers/me', clerkJwt)
  if (sellerRes.status === 404) redirect('/sell')
  if (!sellerRes.ok) throw new Error('No se pudo cargar tu catálogo.')

  const parsedPage = parseInt(params.page ?? '1', 10)
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const offset = (page - 1) * CATALOG_PAGE_SIZE

  const qs = buildCatalogQuery(params, { limit: CATALOG_PAGE_SIZE, offset })
  const productsRes = await medusaFetch(`/store/sellers/me/products${qs}`, clerkJwt)
  if (!productsRes.ok) throw new Error('No se pudo cargar tu catálogo.')
  const data = await productsRes.json() as {
    listings?: CatalogListing[]
    count?: number
    status_counts?: Record<string, number>
  }

  // Deploy-lag safety — same soft-delete mirror check as the dashboard
  // (lib/listing-lifecycle.ts): a product Medusa hasn't natively soft-deleted
  // yet may still come back as a draft; hide anything the mirror already
  // marked 'deleted'.
  let deletedIds = new Set<string>()
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, metadata')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (shop?.id) {
    const { data: deletedRows } = await db
      .from('marketplace_listings')
      .select('medusa_product_id')
      .eq('shop_id', shop.id)
      .eq('status', DELETED_STATUS)
    deletedIds = new Set(
      (deletedRows ?? [])
        .map((row) => row.medusa_product_id as string | null)
        .filter((id): id is string => !!id),
    )
  }

  const listings = filterOutDeleted(data.listings ?? [], deletedIds)
  const total = data.count ?? listings.length
  const totalPages = Math.max(1, Math.ceil(total / CATALOG_PAGE_SIZE))
  const statusCounts = data.status_counts ?? {}
  const hasAnyFilter = Object.entries(params).some(([key, val]) => key !== 'page' && Boolean(val))

  // Per-channel publish toggles (catalog-management epic, Sprint 2 · Story
  // 2.2) — fail-safe OFF: the table's Miyagi/ML toggles render only while the
  // flag is ON. ML additionally needs the same `ml_sync` entitlement gate the
  // /shop/manage/mercadolibre page already uses (reuses the shop row already
  // fetched above for the deleted-ids check — no second Supabase query).
  const channelsFlagEnabled = await isEnabled('catalog.inventory_channels_enabled')
  const mlEntitled = channelsFlagEnabled
    ? (await resolveMlSyncEntitlement(shop?.metadata, { sellerClerkId: user.id })).entitled
    : false

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <SellerBreadcrumb className="mb-1" />
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold">Catálogo</h1>
        <Link href="/sell" className="btn btn-primary">+ Nuevo anuncio</Link>
      </div>
      <p className="text-sm text-[var(--color-muted)] mb-5">
        {total} anuncio{total === 1 ? '' : 's'}
        {hasAnyFilter && (
          <>
            {' · '}
            <Link href="/shop/manage/catalogo" className="hover:underline">Limpiar filtros</Link>
          </>
        )}
      </p>

      <CatalogFilterBar
        params={params}
        categories={CATEGORIES}
        statusFilters={CATALOG_STATUS_FILTERS}
        statusCounts={statusCounts}
      />

      {listings.length === 0 ? (
        <div className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-12 text-center mt-4">
          {hasAnyFilter ? (
            <>
              <p className="font-semibold mb-1">Sin resultados para estos filtros</p>
              <p className="text-sm text-[var(--color-muted)] mb-5">Prueba con otra búsqueda o quita algún filtro.</p>
              <Link href="/shop/manage/catalogo" className="btn btn-secondary">Limpiar filtros</Link>
            </>
          ) : (
            <>
              <div className="text-4xl mb-3">📦</div>
              <p className="font-semibold mb-1">No tienes anuncios publicados</p>
              <p className="text-sm text-[var(--color-muted)] mb-5">Publica tu primer producto, servicio o renta en menos de 2 minutos.</p>
              <Link href="/sell" className="btn btn-primary">Publicar primer anuncio</Link>
            </>
          )}
        </div>
      ) : (
        <>
          <CatalogTable listings={listings} channelsFlagEnabled={channelsFlagEnabled} mlEntitled={mlEntitled} />

          {totalPages > 1 && (
            <div className="flex gap-1 justify-center flex-wrap mt-6">
              {page > 1 && (
                <Link href={buildCatalogPageUrl(params, page - 1)} className="btn btn-secondary btn-sm no-underline">
                  ← Anterior
                </Link>
              )}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = Math.max(1, page - 2) + i
                return p <= totalPages ? (
                  <Link
                    key={p}
                    href={buildCatalogPageUrl(params, p)}
                    className={p === page ? 'btn btn-primary btn-sm no-underline' : 'btn btn-secondary btn-sm no-underline'}
                  >
                    {p}
                  </Link>
                ) : null
              })}
              {page < totalPages && (
                <Link href={buildCatalogPageUrl(params, page + 1)} className="btn btn-secondary btn-sm no-underline">
                  Siguiente →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
