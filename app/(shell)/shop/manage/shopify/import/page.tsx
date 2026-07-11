import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { SellerBreadcrumb } from '../../SellerBreadcrumb'
import ShopifyImport from './ShopifyImport'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Migrar desde Shopify — Configuración' }

/**
 * Seller surface to pull a Shopify shop's catalog into their Miyagi shop
 * (epic 03 · platform-migrations, Sprint 1 · US-1.1). Dark-shipped: 404s
 * until `migrations.connector_enabled` is on. No prior connection needed —
 * any public Shopify shop domain works.
 */
export default async function ShopifyImportPage() {
  if (!(await isEnabled('migrations.connector_enabled'))) notFound()

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

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div style={{ marginBottom: 20 }}>
        <SellerBreadcrumb
          extra={[
            { label: 'Importar', href: '/shop/manage/import' },
            { label: 'Shopify', href: null },
          ]}
        />
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>Migrar desde Shopify</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 4 }}>
          Trae tu catálogo de Shopify a tu tienda Miyagi. Revisa la lista y el reporte de paridad
          antes de importar.
        </p>
      </div>

      <ShopifyImport />
    </div>
  )
}
