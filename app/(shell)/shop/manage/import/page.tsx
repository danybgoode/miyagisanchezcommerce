import { redirect } from 'next/navigation'
import { auth, currentUser } from '@clerk/nextjs/server'
import { isEnabled } from '@/lib/flags'
import ImportClient from './ImportClient'

export const metadata = {
  title: 'Importar catálogo — Miyagi Sánchez',
}

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default async function ImportPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { getToken } = await auth()
  const clerkJwt = await getToken()
  if (!clerkJwt) redirect('/sign-in')

  // Must have a shop to import into — mirror the rest of /shop/manage/*.
  const sellerRes = await fetch(`${MEDUSA_BASE}/store/sellers/me`, {
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      Authorization: `Bearer ${clerkJwt}`,
    },
    cache: 'no-store',
  })
  if (sellerRes.status === 404) redirect('/sell')

  const shopifyMigrationEnabled = await isEnabled('migrations.connector_enabled')

  return <ImportClient shopifyMigrationEnabled={shopifyMigrationEnabled} />
}
