import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import { ensureShop } from '@/lib/ensure-shop'
import ImportClient from './ImportClient'

export const metadata = {
  title: 'Importar catálogo — Miyagi Sánchez',
}

export default async function ImportPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { userId, getToken } = await auth()
  const clerkJwt = await getToken()
  if (!userId || !clerkJwt) redirect('/sign-in')

  // A merchant with no shop yet (e.g. arriving via the onboarding three-doors
  // Door 2, which has no shop-creation step of its own) gets a bare shop
  // created for them here — the SAME idempotent create-or-get `POST
  // /api/sell/shop` already uses (onboarding-three-doors Sprint 1 · Story
  // 1.2b) — instead of being redirected back to `/sell`. A real error (not a
  // missing shop) still surfaces rather than silently proceeding.
  const shop = await ensureShop(userId, clerkJwt)
  if (!shop.ok) redirect('/sell')

  const shopifyMigrationEnabled = await isEnabled('migrations.connector_enabled')

  return <ImportClient shopifyMigrationEnabled={shopifyMigrationEnabled} />
}
