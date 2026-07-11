import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import CobrosWizardClient from './CobrosWizardClient'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Cobros — Configuración' }

/**
 * The S7 cobros mini-wizard (onboarding three-doors, Sprint 3 · Story 3.1) — a
 * NEW, dedicated onboarding entry point. It wraps the EXISTING MercadoPago
 * OAuth (/api/mp/connect + its callback) unchanged; the only touch to that
 * flow is the post-return redirect target (see /api/mp/connect/route.ts +
 * .../callback/route.ts). The classic flat `/shop/manage/settings/pagos`
 * panel (Compra Protegida / Stripe / Mercado Pago / SPEI) is untouched and
 * stays the surface for ongoing payments management.
 */
export default async function CobrosWizardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, name, metadata')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  const settings = ((shop.metadata as Record<string, unknown> | null)?.settings ?? {}) as Record<string, unknown>
  const mp = settings.mercadopago as { connected?: boolean } | undefined

  return (
    <CobrosWizardClient
      mpConnected={!!mp?.connected}
      mp={sp.mp ?? null}
      reason={sp.reason ?? null}
      shopSlug={shop.slug}
    />
  )
}
