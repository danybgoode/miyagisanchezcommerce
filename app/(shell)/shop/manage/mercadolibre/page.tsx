import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getMlConnection } from '@/lib/ml-connection'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import MercadoLibreStatus from './MercadoLibreStatus'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Mercado Libre — Configuración' }

/**
 * Seller status surface for the Mercado Libre connection (epic 03 ·
 * mercadolibre-sync, Sprint 1 · US-3). Dark-shipped: 404s entirely until
 * `ml.connect_enabled` is flipped on. Reads the sanitised connection + health
 * via the backend bridge (no token ever reaches here).
 */
export default async function MercadoLibrePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>
}) {
  const sp = await searchParams

  // Dark-ship: hidden until the flag is on.
  if (!(await isEnabled('ml.connect_enabled'))) notFound()

  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('slug')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!shop?.slug) redirect('/sell')

  const { connection, health } = await getMlConnection(shop.slug)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div style={{ marginBottom: 20 }}>
        <SellerBreadcrumb extra={[{ label: 'Mercado Libre', href: null }]} />
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>Mercado Libre</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 4 }}>
          Conecta tu cuenta de Mercado Libre para sincronizar tu catálogo e inventario con Miyagi.
        </p>
      </div>

      <MercadoLibreStatus
        connection={connection}
        health={health}
        error={sp.error ?? null}
        justConnected={sp.connected === '1'}
      />
    </div>
  )
}
