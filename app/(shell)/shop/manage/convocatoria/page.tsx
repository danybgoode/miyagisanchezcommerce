import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { isEnabled } from '@/lib/flags'
import { SellerBreadcrumb } from '../SellerBreadcrumb'
import ConvocatoriaSettingsClient from './ConvocatoriaSettingsClient'

export const metadata = { title: 'Convocatoria — Miyagi Sánchez' }

export default async function ConvocatoriaManagePage() {
  // Dark-shipped behind the launchpad kill-switch — the whole surface 404s
  // until an admin flips `launchpad.enabled` on (fail-safe OFF).
  if (!(await isEnabled('launchpad.enabled'))) notFound()

  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, slug, metadata')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  const meta = (shop.metadata ?? {}) as Record<string, unknown>
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const lp = (settings.launchpad ?? {}) as { accepts_manuscripts?: boolean; guidelines?: string | null }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div style={{ marginBottom: 20 }}>
        <SellerBreadcrumb extra={[{ label: 'Convocatoria', href: null }]} />
        <h1 style={{ fontWeight: 700, fontSize: 22, marginTop: 8 }}>Convocatoria de manuscritos</h1>
      </div>

      <ConvocatoriaSettingsClient
        initial={{
          accepts_manuscripts: lp.accepts_manuscripts === true,
          guidelines: typeof lp.guidelines === 'string' ? lp.guidelines : null,
        }}
        publicUrl={`/s/${shop.slug}/convocatoria`}
      />
    </div>
  )
}
