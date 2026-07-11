import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { getMySeller } from '@/lib/get-my-seller'
import { ensureShop } from '@/lib/ensure-shop'
import ImportClient from './ImportClient'

export const metadata = {
  title: 'Importar catálogo — Miyagi Sánchez',
}

export default async function ImportPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  // A merchant with no shop yet (e.g. arriving via the onboarding three-doors
  // Door 2, which has no shop-creation step of its own) can get a bare shop
  // created for them here — the SAME idempotent create-or-get `POST
  // /api/sell/shop` already uses (onboarding-three-doors Sprint 1 · Story
  // 1.2b) — instead of being redirected back to `/sell`. Gated behind
  // `onboarding.three_doors_enabled` (cross-agent review finding): auto-
  // provisioning a real Medusa seller on a bare page GET is a live behavior
  // change, not presentational routing, so it stays OFF (today's original
  // redirect) until the flag is deliberately flipped — keeping the whole
  // epic dark, not just the /sell redirect. A merchant who already owns a
  // shop is completely unaffected either way.
  const existingShop = await getMySeller()
  if (!existingShop) {
    if (!(await isEnabled('onboarding.three_doors_enabled'))) redirect('/sell')

    const { userId, getToken } = await auth()
    const clerkJwt = await getToken()
    if (!userId || !clerkJwt) redirect('/sign-in')

    const created = await ensureShop(userId, clerkJwt)
    if (!created.ok) redirect('/sell')
  }

  const shopifyMigrationEnabled = await isEnabled('migrations.connector_enabled')

  return <ImportClient shopifyMigrationEnabled={shopifyMigrationEnabled} />
}
