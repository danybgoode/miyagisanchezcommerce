import { redirect } from 'next/navigation'
import { currentUser } from '@clerk/nextjs/server'
import BienvenidaClient from './BienvenidaClient'

export const metadata = {
  title: 'Bienvenido — Miyagi Sánchez',
}

/**
 * S1 Bienvenida (onboarding three-doors, Sprint 1 · Story 1.1). Reachable
 * directly (Daniel/QA can open the URL) regardless of the
 * `onboarding.three_doors_enabled` flag — the flag only gates whether
 * `/sell` *auto-redirects* here, not whether the page itself renders; the
 * flag-off case simply means fewer people arrive organically. Signed-out
 * visitors go to sign-in first, same as every other `/sell*` surface.
 */
export default async function BienvenidaPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  return <BienvenidaClient firstName={user.firstName ?? null} />
}
