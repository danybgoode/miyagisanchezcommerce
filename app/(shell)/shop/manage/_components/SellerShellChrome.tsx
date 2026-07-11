import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import SellerNav from '../SellerNav'
import SellerAnnouncementStrip from '../SellerAnnouncementStrip'
import { getActiveAnnouncement } from '@/lib/announcements'
import { isEnabled, type FlagKey } from '@/lib/flags'
import { SELLER_NAV } from '@/lib/seller-nav'
import { db } from '@/lib/supabase'
import { computeShopCompletion, completedSectionKeys, type ShopRow } from '@/lib/setup-guide'
import { orderedSections } from '@/lib/shop-settings/taxonomy'

/**
 * The seller-distinct shell chrome — dark brand top bar ("Volver a comprar") +
 * the announcement strip + the `SellerNav` rail/bar (incl. the flag-safe nav
 * parity + mobile badges/completion-pill data it needs). Extracted from
 * `app/(shell)/shop/manage/layout.tsx` (catalog-management epic, Sprint 6 ·
 * Story 6.1) so `app/(shell)/sell/layout.tsx` can render the identical shell
 * for a signed-in shop owner on `/sell`/`/sell/setup`, without duplicating this
 * data-fetching. Owns its own `getActiveAnnouncement('seller')` fetch (already
 * `unstable_cache`-backed, so two call sites in one request share the cache
 * entry, not two Supabase round-trips) — callers just render `<SellerShellChrome>`.
 *
 * Callers are responsible for their own white-label defer (checking the same
 * `x-miyagi-embed`/`x-miyagi-channel` headers) BEFORE rendering this — it does
 * not re-check white-label itself, to avoid a third independent header read.
 *
 * Renders unconditionally for whatever page it wraps, including a transiently
 * signed-out visitor (e.g. mid-redirect) — every read here degrades to a safe
 * empty default rather than throwing, same discipline the original
 * `shop/manage/layout.tsx` already followed.
 */
export default async function SellerShellChrome({ children }: { children: React.ReactNode }) {
  const announcement = await getActiveAnnouncement('seller')

  // R13 flag-safe nav parity (catalog-management S5 · Story 5.1): resolve every
  // distinct flag the nav config references via the SAME isEnabled() the gated
  // pages use — never fork the read — so a flagged entry (e.g. Ganancias) only
  // renders when its page would actually resolve.
  const navFlagKeys = Array.from(new Set(
    SELLER_NAV.flatMap(group => group.entries.map(entry => entry.flag)).filter((f): f is FlagKey => !!f)
  ))
  const navFlagResults = await Promise.all(navFlagKeys.map(flag => isEnabled(flag)))
  const enabledFlags = new Set<FlagKey>(navFlagKeys.filter((_, i) => navFlagResults[i]))

  // Mobile bar badges + Configuración pill + "Ver tienda pública" link (catalog-
  // management S5 · Story 5.2). One shop-row fetch feeds both the pending counts
  // and the completion flags (same columns `settings/page.tsx` already selects),
  // so the badge/pill data never drifts from what those pages compute.
  const user = await currentUser()
  const { data: shop, error: shopError } = user
    ? await db
        .from('marketplace_shops')
        .select('id, slug, name, description, metadata, mp_enabled, custom_domain, ucp_webhook_url')
        .eq('clerk_user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null }
  if (shopError) console.error('[SellerShellChrome] shop lookup failed:', shopError)

  let badges: Partial<Record<string, number>> = {}
  let configIncomplete = false
  const shopSlug = (shop?.slug as string | undefined) ?? null

  if (shop?.id) {
    const [{ count: pendingOrdersCount, error: ordersError }, { count: pendingOffersCount, error: offersError }] = await Promise.all([
      db.from('marketplace_orders').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).in('status', ['paid', 'processing']),
      db.from('marketplace_offers').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).eq('status', 'pending'),
    ])
    if (ordersError) console.error('[SellerShellChrome] pending-orders count failed:', ordersError)
    if (offersError) console.error('[SellerShellChrome] pending-offers count failed:', offersError)
    badges = { pedidos: pendingOrdersCount ?? 0, ofertas: pendingOffersCount ?? 0 }

    const completion = computeShopCompletion(shop as unknown as ShopRow)
    configIncomplete = completedSectionKeys(completion).size < orderedSections().length
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ── Dark brand top bar ── (brand-accent surface; --fg-inverse on --accent
          is the documented AA pair, theme-safe and design-token-guard clean). */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'var(--accent)',
          color: 'var(--fg-inverse)',
        }}
      >
        <div
          className="app-shell"
          style={{
            minHeight: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontWeight: 600,
              fontSize: 14,
              fontFamily: 'var(--font-display, var(--font-sans))',
              color: 'var(--fg-inverse)',
            }}
          >
            <i className="iconoir-shop" style={{ fontSize: 18, lineHeight: 1 }} />
            Miyagi Sánchez · Vendedor
          </span>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              textDecoration: 'none',
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
              color: 'var(--fg-inverse)',
              opacity: 0.92,
            }}
          >
            <i className="iconoir-arrow-left" style={{ fontSize: 16, lineHeight: 1 }} />
            Volver a comprar
          </Link>
        </div>
      </div>

      <SellerAnnouncementStrip
        announcement={
          announcement && { id: announcement.id, text: announcement.text, ctaLabel: announcement.ctaLabel, ctaLink: announcement.ctaLink }
        }
      />

      {/* ── Rail + content ── */}
      <div
        className="app-shell"
        style={{
          display: 'flex',
          gap: 24,
          alignItems: 'flex-start',
          paddingTop: 20,
        }}
      >
        <SellerNav enabledFlags={enabledFlags} badges={badges} configIncomplete={configIncomplete} shopSlug={shopSlug} />
        <main
          style={{
            flex: 1,
            minWidth: 0,
            // Reserve room for the fixed mobile seller bar (no-op on desktop).
            paddingBottom: 'calc(80px + env(safe-area-inset-bottom))',
          }}
        >
          {children}
        </main>
      </div>
    </div>
  )
}
