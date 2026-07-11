import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import { getTenantIntake } from '@/lib/tenant-intake'
import { personalizeDoors } from '@/lib/onboarding-personalization'
import PuertasClient from './PuertasClient'

export const metadata = {
  title: 'Elige tu camino — Miyagi Sánchez',
}

/**
 * S2 Tres puertas (onboarding three-doors, Sprint 1 · Story 1.2). Reads
 * `tenant_intake` server-side and passes the already-personalized door order
 * + subtitle down — `personalizeDoors` is pure, so this page is the ONE
 * place the mapping runs (the client component just renders the result).
 */
export default async function PuertasPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const intake = await getTenantIntake(user.id)
  const { order, subtitle } = personalizeDoors(intake)

  return <PuertasClient order={order} subtitle={subtitle} />
}
