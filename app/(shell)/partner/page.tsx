import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { recruitingV3Enabled } from '@/lib/recruiting-v3'
import { db } from '@/lib/supabase'
import { getPartnerIdentityByClerkId } from '@/lib/promoter'
import { PORTFOLIO_FLAG } from '@/lib/portfolio/gate-server'
import { shopUrlFor } from '@/lib/market-url'
import { SITE_ORIGIN } from '@/lib/market-seo'
import { getShop } from '@/lib/listings'
import { readPublicSellerMarket } from '@/lib/owned-market'
import { marketVisibility } from '@/lib/market-visibility'
import { partnerWorkspaceAdmitted } from '@/lib/founding-operator-activation'
import PartnerPortfolio from './PartnerPortfolio'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis tiendas — Socios', robots: { index: false } }

interface GrantedShop {
  grantId: string
  role: 'manager' | 'viewer'
  grantedAt: string
  shop: {
    id: string
    slug: string
    name: string
    operatingMarketCode: 'mx' | 'us' | null
    operatingMarketLabel: string
    marketplacePublicationLabel: string
  }
}

const ROLE_LABEL: Record<'manager' | 'viewer', string> = { manager: 'Gestor', viewer: 'Solo lectura' }

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * `/partner` — read-only v1 dashboard (Miyagi Partners · Sprint 2 · US-2.2).
 * Lists every shop currently granted to the VIEWING partner (a Clerk-bound
 * `marketplace_promoters` row — the same `clerk_user_id` bind
 * `/api/promoter/me/bind` stamps for the `/promotor/cerrar` workspace), only
 * unrevoked grants.
 *
 * No impersonation: the per-shop link is the plain, normal `/shop/manage` URL
 * — clicking it does NOT switch tenant context. It lands wherever the
 * viewer's own Clerk session already resolves (their own shop if they have
 * one, or `/sell` otherwise) — exactly the acceptance criteria's point. The
 * public storefront link (`/s/[slug]`), by contrast, IS shop-specific and
 * read-only, so it's offered alongside as the actually-useful "see it live"
 * deep link.
 *
 * Admission is track-aware: the existing Promotor path remains behind
 * `partners.mcp_enabled`; a founding-operator identity is admitted only by
 * `partners.recruiting_v3_enabled`. `force-dynamic` keeps either OFF result
 * from baking into a cached static shell.
 *
 * STEWARDSHIP PORTFOLIO (merchant-partner-lifecycle S1.2): with
 * `promoter.partner_portfolio_enabled` ON, the `<PartnerPortfolio>` action queue
 * renders ABOVE the grant list for the legacy Promotor track. Founding operators
 * have a grant-only workspace and never inherit Promotor stewardship tooling.
 * With the flag OFF — its born state — the
 * expression below evaluates to `false`, React renders nothing for it, and this
 * page's markup is BYTE-IDENTICAL to what it serves today. That is the whole
 * promise of the kill-switch, and it is why the portfolio is an ADDITIONAL
 * section rather than a replacement for the grant list (README D1). The two
 * answer different questions — "which shops may I administer" vs. "which
 * merchants am I accountable for right now" — and both read from seams that can
 * never disagree about who is in scope.
 */
export default async function PartnerDashboardPage({
  searchParams,
}: {
  // Next.js 16: a Promise, always awaited (AGENTS).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const [partnerMcpEnabled, recruitingEnabled, portfolioEnabled, promoter] = await Promise.all([
    isEnabled('partners.mcp_enabled'),
    recruitingV3Enabled(),
    isEnabled(PORTFOLIO_FLAG),
    getPartnerIdentityByClerkId(user.id),
  ])
  if (promoter) {
    if (!partnerWorkspaceAdmitted(promoter.program_track ?? 'promoter', partnerMcpEnabled, recruitingEnabled)) notFound()
  } else if (!partnerMcpEnabled) {
    // Preserve the existing PRM binding entry only under its existing flag.
    notFound()
  }
  const foundingOperator = promoter ? promoter.program_track === 'founding_operator' : false
  const showPortfolio = portfolioEnabled && !foundingOperator

  const params = new URLSearchParams()
  if (showPortfolio) {
    for (const [key, value] of Object.entries(await searchParams)) {
      if (typeof value === 'string') params.set(key, value)
      // An array-valued param (`?due=a&due=b`) keeps only the FIRST value —
      // the pure filter parser reads one value per key, and silently honoring
      // the last one would make two identical-looking URLs filter differently.
      else if (Array.isArray(value) && value.length > 0) params.set(key, value[0])
    }
  }

  let grants: GrantedShop[] = []
  if (promoter) {
    const { data: grantRows } = await db
      .from('partner_grants')
      .select('id, shop_id, role, created_at')
      .eq('promoter_id', promoter.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    const rows = (grantRows ?? []) as Array<{ id: string; shop_id: string; role: 'manager' | 'viewer'; created_at: string }>

    const shopIds = [...new Set(rows.map((g) => g.shop_id))]
    const { data: shops } = shopIds.length
      ? await db.from('marketplace_shops').select('id, slug, name').in('id', shopIds)
      : { data: [] }
    const rawShops = (shops ?? []) as Array<{ id: string; slug: string; name: string }>
    // The grant/mirror supplies the membership and slug, never the operating
    // market. Resolve that separately from Medusa's public seller projection.
    const enriched = await Promise.all(rawShops.map(async (shop) => {
      // `getShop` rejects (not returns null) on a network fault, and one rejection
      // inside Promise.all would 500 the whole partner dashboard over a single
      // unreachable shop. Degrade per-shop: an unreadable projection is the
      // explicit unavailable state, not an assumed market.
      let publicSeller = null
      try {
        publicSeller = shop.slug ? await getShop(shop.slug) : null
      } catch (error) {
        console.warn(`[partner] seller projection unavailable for ${shop.slug}:`, error)
      }
      const visibility = marketVisibility(readPublicSellerMarket(publicSeller))
      return [shop.id, { ...shop, ...visibility }] as const
    }))
    const shopById = new Map(enriched)

    grants = rows
      .map((g) => {
        const shop = shopById.get(g.shop_id)
        return shop ? { grantId: g.id, role: g.role, grantedAt: g.created_at, shop } : null
      })
      .filter((g): g is GrantedShop => g !== null)
  }

  return (
    <div className={showPortfolio ? 'max-w-4xl mx-auto px-4 py-8 space-y-6' : 'max-w-2xl mx-auto px-4 py-8 space-y-6'}>
      <header>
        <h1 className="text-2xl font-bold">{foundingOperator ? 'Miyagi Partners' : 'Mis tiendas'}</h1>
        {foundingOperator && promoter && (
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Founding Commerce Operator{promoter.name && <span className="ml-2">· {promoter.name}</span>}
          </p>
        )}
        {!foundingOperator && promoter ? (
          <p className="text-sm text-[var(--color-muted)] mt-1">
            {foundingOperator ? (
              <>Operador fundador de comercio</>
            ) : (
              <>Socio <span className="font-mono font-semibold">{promoter.code}</span></>
            )}
            {promoter.name && <span className="ml-2">· {promoter.name}</span>}
          </p>
        ) : !promoter ? (
          <p className="text-sm text-[var(--color-muted)] mt-1">
            No encontramos una cuenta de socio vinculada a tu sesión.
          </p>
        ) : null}
      </header>

      {showPortfolio && <PartnerPortfolio clerkUserId={user.id} searchParams={params} />}

      {!promoter && (
        <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
          Vincula tu código de promotor (PRM-…) en{' '}
          <Link href="/promotor/cerrar" className="underline">/promotor/cerrar</Link> para empezar a operar
          como socio. Si crees que esto es un error, contacta al equipo de Miyagi.
        </div>
      )}

      {promoter && grants.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
          {foundingOperator ? (
            <>
              Your operator identity is active and currently has zero shops. Program approval is not shop access:
              a shop appears only after a separate merchant or Miyagi administrator grants it. The next step is the
              founder review for the bounded 90-day proof.
            </>
          ) : (
            <>
              Todavía no tienes tiendas asignadas. Una tienda llega aquí en cuanto (a) la cierras tú mismo
              en <Link href="/promotor/cerrar" className="underline">/promotor/cerrar</Link> — el acceso se otorga
              automáticamente — o (b) un administrador de Miyagi te concede acceso a una tienda existente.
            </>
          )}
        </div>
      )}

      {grants.length > 0 && (
        <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
          {grants.map((g) => (
            <li key={g.grantId} className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{g.shop.name}</div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">
                  {ROLE_LABEL[g.role]} · desde {fmtDate(g.grantedAt)}
                </div>
                <div className="text-xs text-[var(--color-muted)] mt-0.5">
                  {g.shop.operatingMarketLabel} · {g.shop.marketplacePublicationLabel}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                <Link href={shopUrlFor(SITE_ORIGIN, g.shop.slug)} target="_blank" rel="noreferrer" className="underline">
                  Ver tienda
                </Link>
                {!foundingOperator && (
                  <Link href="/shop/manage" className="underline">
                    Administrar
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
