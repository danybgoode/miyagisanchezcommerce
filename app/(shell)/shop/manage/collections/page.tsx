import { redirect } from 'next/navigation'
import { currentUser, auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import CollectionsClient, { type Collection } from './CollectionsClient'

export const metadata = { title: 'Colecciones — Mi tienda' }

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export default async function CollectionsPage() {
  const user = await currentUser()
  if (!user) redirect('/sign-in')

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, name')
    .eq('clerk_user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) redirect('/sell')

  let initialCollections: Collection[] = []
  try {
    const { getToken } = await auth()
    const clerkJwt = await getToken()
    if (clerkJwt) {
      const res = await fetch(`${MEDUSA_BASE}/store/sellers/me/collections`, {
        headers: {
          'x-publishable-api-key': PUB_KEY,
          Authorization: `Bearer ${clerkJwt}`,
        },
        cache: 'no-store',
      })
      if (res.ok) {
        const data = await res.json()
        initialCollections = data.collections ?? []
      }
    }
  } catch {
    // Non-fatal — the client falls back to its own refresh.
  }

  return <CollectionsClient shopName={shop.name} initialCollections={initialCollections} />
}
