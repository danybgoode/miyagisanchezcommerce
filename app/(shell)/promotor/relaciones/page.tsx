import { redirect, notFound } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import PromoterRelacionesClient from './PromoterRelacionesClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mis comercios — Promotor', robots: { index: false } }

/**
 * Promoter operating pipeline (founding-merchant-activation-ops S2.3). Every
 * relationship this promoter owns or has an active partner grant on: stage,
 * age in stage, next action (or the "sin próxima acción" warning), consent
 * state and blocker. Thin screen over `GET /api/promoter/relationships` +
 * `GET/POST /api/promoter/relationship/[id]/*`. Clerk- +
 * `promoter.activation_crm_enabled`-gated (404 with the flag off, same
 * posture as `/promotor/cerrar`).
 */
export default async function PromoterRelacionesPage() {
  if (!(await isEnabled('promoter.activation_crm_enabled'))) notFound()

  const user = await currentUser()
  if (!user) redirect('/sign-in')

  return <PromoterRelacionesClient />
}
