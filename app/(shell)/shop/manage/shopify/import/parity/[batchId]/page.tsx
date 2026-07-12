import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { getShopifyBatchParity } from '@/lib/shopify-import-bridge'
import { notifyIfVeryCustom } from '@/lib/migration-estimate-store'
import { VERY_CUSTOM_LISTING_THRESHOLD, type ParityVerdict } from '@/lib/migration-parity'
import { SellerBreadcrumb } from '../../../../SellerBreadcrumb'
import MigrationEstimateCard from './MigrationEstimateCard'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Reporte de paridad — Shopify' }

const VERDICT_BADGE: Record<ParityVerdict, { icon: string; bg: string; fg: string; label: string }> = {
  mapped: { icon: 'iconoir-check', bg: 'var(--success-soft)', fg: 'var(--success)', label: 'Igual' },
  partial: { icon: 'iconoir-warning-triangle', bg: 'var(--warning-soft)', fg: 'var(--warning)', label: 'Parcial' },
  none: { icon: 'iconoir-xmark', bg: 'var(--danger-soft)', fg: 'var(--danger)', label: 'Sin equivalente' },
}

/**
 * The parity report for a staged Shopify batch (epic 03 · platform-migrations
 * S1 · US-1.2) — an honest "this maps, this doesn't" BEFORE any money changes
 * hands or any product is confirmed. Authenticated seller-dashboard page
 * (decided over a public token link — matches how the sprint's own smoke
 * walkthrough is run, no new public-surface risk). es-MX, no jargon.
 */
export default async function ShopifyParityPage({
  params,
}: {
  params: Promise<{ batchId: string }>
}) {
  if (!(await isEnabled('migrations.connector_enabled'))) notFound()

  const { batchId } = await params

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

  const result = await getShopifyBatchParity({ slug: shop.slug }, batchId)
  if (!result.ok) notFound()
  const { report } = result

  // Story 2.3 — the notification must fire the moment the report itself is
  // computed (this page load), not gated behind the estimate card below,
  // which is deliberately hidden for a very-custom report (review catch —
  // the card was the ONLY caller of the notify path, and it's hidden for
  // exactly the case that path exists to notify on).
  if (report.veryCustom) {
    await notifyIfVeryCustom(batchId).catch((e) => console.error('[parity page] very-custom notify failed:', e))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div style={{ marginBottom: 20 }}>
        <SellerBreadcrumb
          extra={[
            { label: 'Importar', href: '/shop/manage/import' },
            { label: 'Shopify', href: '/shop/manage/shopify/import' },
            { label: 'Reporte de paridad', href: null },
          ]}
        />
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>Reporte de paridad</h1>
        <p style={{ fontSize: 14, color: 'var(--fg-muted)', marginTop: 4 }}>
          Esto es lo que encontramos en tu tienda Shopify y cómo se compara con Miyagi — antes de
          importar nada.
        </p>
      </div>

      {report.veryCustom && (
        <div
          style={{
            padding: '14px 16px', borderRadius: 'var(--r-md)', marginBottom: 16,
            background: 'var(--warning-soft)', color: 'var(--warning)', fontSize: 14,
          }}
        >
          <strong>Esta tienda es "muy personalizada".</strong> {report.veryCustomReason}{' '}
          Un consultor de Miyagi te contactará directamente para revisar tu caso.
        </div>
      )}

      {!report.veryCustom && report.listingCount > VERY_CUSTOM_LISTING_THRESHOLD && (
        <MigrationEstimateCard batchId={batchId} />
      )}

      <div
        style={{
          display: 'flex', gap: 16, marginBottom: 20, padding: 16,
          borderRadius: 'var(--r-lg)', border: '1.5px solid var(--border)', background: 'var(--bg-elevated)',
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{report.listingCount}</div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>producto(s)</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{report.imageCount}</div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>imagen(es)</div>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{report.hasPolicies ? 'Sí' : 'No'}</div>
          <div style={{ fontSize: 13, color: 'var(--fg-muted)' }}>texto de políticas</div>
        </div>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {report.sections.map((section) => {
          const badge = VERDICT_BADGE[section.verdict]
          return (
            <li
              key={section.key}
              style={{
                padding: 14, borderRadius: 'var(--r-md)', border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{section.label}</span>
                <span
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700,
                    padding: '2px 8px', borderRadius: 'var(--r-pill)', background: badge.bg, color: badge.fg,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <i className={badge.icon} aria-hidden /> {badge.label}
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--fg-muted)', margin: 0 }}>{section.note}</p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
