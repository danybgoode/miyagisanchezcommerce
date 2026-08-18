import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import { resolveOwnShop, listOwnWallEntries } from '@/lib/wall/store'
import { getShopListings, getShopCollections } from '@/lib/listings'
import StudioClient from './StudioClient'
import { resolveSectionAvailability } from '@/lib/shop-presentation/availability'
import type { SettingsTree } from '@/lib/shop-settings/types'
import type { Metadata } from 'next'

/**
 * Living Shop — the seller studio (epic 07, Sprint 5; the Wall tab lands in
 * Sprint 1 so authoring exists the moment persistence does).
 *
 * A NEW guarded root, not another `settings/_sections/*` component (epic D8).
 * `lib/shop-settings/monolith-guard.ts` scans this directory alongside the
 * settings surface, so nothing here can quietly grow into the monolith the
 * settings refactor already had to delete once.
 */

export const metadata: Metadata = { title: 'Mi tienda — apariencia y contenido' }
export const dynamic = 'force-dynamic'

export default async function ShopStudioPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const shop = await resolveOwnShop(user.id)
  if (!shop) redirect('/sell')

  // The three object pools the composer picks from — the seller's OWN catalog,
  // collections and events. Fetched here rather than through a browser-callable
  // route so the picker cannot be pointed at another shop by changing a query
  // string: there is no shop parameter anywhere in this path.
  const [entries, listings, collections, eventRows, shopRow] = await Promise.all([
    listOwnWallEntries(shop.id),
    getShopListings(shop.slug),
    getShopCollections(shop.slug),
    db.from('marketplace_events')
      .select('slug, title, starts_at, status')
      .eq('shop_id', shop.id)
      .order('starts_at', { ascending: false })
      .limit(50),
    db.from('marketplace_shops').select('metadata, logo_url').eq('id', shop.id).maybeSingle(),
  ])

  const settings = ((shopRow.data?.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const st = settings as SettingsTree

  // The SAME availability the public nav uses, so the section manager tells a
  // merchant the truth about what will actually appear rather than its own guess.
  const availability = await resolveSectionAvailability({
    shopId: shop.id,
    settings,
    collectionCount: collections.length,
  })

  return (
    <main>
      <div className="max-w-5xl mx-auto px-4 pt-8">
        <SellerBreadcrumb
          crumbs={[
            { label: 'Mi tienda', href: '/shop/manage' },
            { label: 'Apariencia y contenido', href: null },
          ]}
        />
      </div>
      <StudioClient
        shop={{ slug: shop.slug, name: shop.name }}
        initialEntries={entries}
        settings={settings}
        availability={availability as unknown as Record<string, boolean>}
        brand={{
          // The SAME props the shipped `Diseno` section receives from its own
          // route — this tab mounts that component, it does not reimplement it
          // (Story 5.1), so the prop shape is imported rather than invented.
          name: shop.name,
          logo_url: (shopRow.data as unknown as { logo_url?: string | null })?.logo_url ?? null,
          theme: st.theme ?? null,
          preset: st.preset ?? null,
          escrow_mode: st.checkout?.escrow_mode ?? null,
          show_phone: st.checkout?.show_phone ?? null,
          phone: st.checkout?.phone ?? null,
          whatsapp_cta: st.checkout?.whatsapp_cta ?? null,
          local_pickup: st.shipping?.local_pickup ?? null,
          announcement: st.announcement ?? null,
          hero: st.hero ?? null,
          theme_preset: st.theme_preset ?? null,
          listings: listings.map((l) => ({
            id: l.id,
            title: l.title,
            imageUrl: l.images?.[0]?.url ?? null,
          })),
        }}
        objects={{
          products: listings.map((l) => ({
            id: l.id,
            title: l.title,
            imageUrl: l.images?.[0]?.url ?? null,
          })),
          collections: collections.map((c) => ({ handle: c.handle, name: c.name })),
          events: (eventRows.data ?? []).map((e) => ({
            slug: e.slug as string,
            title: e.title as string,
            startsAt: e.starts_at as string,
            cancelled: e.status === 'cancelled',
          })),
        }}
      />
    </main>
  )
}
