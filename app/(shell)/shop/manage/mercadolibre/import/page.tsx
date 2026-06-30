import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getMlConnection } from '@/lib/ml-connection'
import { SellerBreadcrumb } from '../../SellerBreadcrumb'
import MercadoLibreImport from './MercadoLibreImport'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Importar de Mercado Libre — Configuración' }

/**
 * Seller surface to import a connected seller's Mercado Libre catalog into their
 * Miyagi shop (epic 03 · mercadolibre-sync, Sprint 2 · US-6). Dark-shipped: 404s
 * until `ml.import_enabled` is on. Requires an active ML connection; otherwise it
 * sends the seller back to the connect status page.
 */
export default async function MercadoLibreImportPage() {
  // Dark-ship: hidden until the import flag is on.
  if (!(await isEnabled('ml.import_enabled'))) notFound()

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

  const { connection } = await getMlConnection(shop.slug)
  const connected = !!connection && connection.status === 'connected'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div style={{ marginBottom: 20 }}>
        <SellerBreadcrumb
          extra={[
            { label: 'Mercado Libre', href: '/shop/manage/mercadolibre' },
            { label: 'Importar', href: null },
          ]}
        />
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>Importar de Mercado Libre</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 4 }}>
          Trae tus publicaciones activas de Mercado Libre a tu tienda Miyagi. Revisa la lista,
          omite las duplicadas y elige cuáles importar.
        </p>
      </div>

      {connected ? (
        <MercadoLibreImport nickname={connection?.ml_nickname ?? null} />
      ) : (
        <div
          style={{
            padding: 18,
            borderRadius: 'var(--r-lg)',
            border: '1.5px solid var(--border)',
            background: 'var(--bg-elevated)',
            fontSize: 14,
          }}
        >
          <p style={{ margin: 0, color: 'var(--fg-muted)' }}>
            Primero conecta tu cuenta de Mercado Libre para poder importar tu catálogo.
          </p>
          <a
            href="/shop/manage/mercadolibre"
            style={{
              display: 'inline-block', marginTop: 12, padding: '10px 16px', borderRadius: 'var(--r-md)',
              fontSize: 14, fontWeight: 600, background: 'var(--accent)', color: 'var(--fg-inverse)',
              textDecoration: 'none',
            }}
          >
            Conectar Mercado Libre
          </a>
        </div>
      )}
    </div>
  )
}
