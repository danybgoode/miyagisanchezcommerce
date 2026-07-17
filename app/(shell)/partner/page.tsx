import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/supabase'
import { getPromoterByClerkId } from '@/lib/promoter'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis tiendas — Socios', robots: { index: false } }

interface GrantedShop {
  grantId: string
  role: 'manager' | 'viewer'
  grantedAt: string
  shop: { id: string; slug: string; name: string }
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
 * Behind `partners.mcp_enabled` — flag off → `notFound()`. `force-dynamic` so
 * that 404 doesn't bake into the prerender (LEARNINGS: a flag flip must be
 * visible on the very next request, not held back by a cached static shell).
 */
export default async function PartnerDashboardPage() {
  if (!(await isEnabled('partners.mcp_enabled'))) notFound()

  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const promoter = await getPromoterByClerkId(user.id)

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
    const shopById = new Map((shops ?? []).map((s) => [s.id as string, s as { id: string; slug: string; name: string }]))

    grants = rows
      .map((g) => {
        const shop = shopById.get(g.shop_id)
        return shop ? { grantId: g.id, role: g.role, grantedAt: g.created_at, shop } : null
      })
      .filter((g): g is GrantedShop => g !== null)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Mis tiendas</h1>
        {promoter ? (
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Socio <span className="font-mono font-semibold">{promoter.code}</span>
            {promoter.name && <span className="ml-2">· {promoter.name}</span>}
          </p>
        ) : (
          <p className="text-sm text-[var(--color-muted)] mt-1">
            No encontramos una cuenta de socio vinculada a tu sesión.
          </p>
        )}
      </header>

      {!promoter && (
        <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
          Vincula tu código de promotor (PRM-…) en{' '}
          <a href="/promotor/cerrar" className="underline">/promotor/cerrar</a> para empezar a operar
          como socio. Si crees que esto es un error, contacta al equipo de Miyagi.
        </div>
      )}

      {promoter && grants.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
          Todavía no tienes tiendas asignadas. Una tienda llega aquí en cuanto (a) la cierras tú mismo
          en <a href="/promotor/cerrar" className="underline">/promotor/cerrar</a> — el acceso se otorga
          automáticamente — o (b) un administrador de Miyagi te concede acceso a una tienda existente.
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
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                <a href={`/s/${g.shop.slug}`} target="_blank" rel="noreferrer" className="underline">
                  Ver tienda
                </a>
                <a href="/shop/manage" className="underline">
                  Administrar
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
